"""
train_classifier.py

Trains the XGBoost tax-category classifier with the fixes from the plan
review baked in:

  FIX C — Wallet-level train/test split (GroupShuffleSplit on
          wallet_address), not a random row split. A row-level split lets
          same-wallet transactions leak into both train and test, which
          inflates accuracy in a way that won't generalize to a wallet
          the model has never seen.

  FIX A — Reported accuracy is broken out into:
            - overall (the vanity number)
            - known-contract subset (near-100%, not the interesting part
              — this is just the model re-deriving methodCategory)
            - unknown-contract subset (the number that actually matters,
              since this is exactly what the rule engine can't do)
          Only the unknown-contract number should go in front of judges
          as "why ML helps here."

  FIX E — No claims about Gemini call counts live in this file; that's a
          product-copy issue, not a training issue. See note at bottom.

Output: models/xgboost_classifier.json (native) AND
        models/xgboost_classifier.onnx (for in-browser ONNX.js inference —
        FIX D, no Python server needed at demo time).
"""

import os
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.preprocessing import LabelEncoder

CATEGORY_MAP = {"trade": 0, "income": 1, "transfer": 2, "nft": 3}
CATEGORY_NAMES = ["trade", "income", "transfer", "nft"]

FEATURE_COLUMNS = [
    "method_category",     # categorical -> encoded
    "direction",           # binary
    "eth_value",
    "usd_value",
    "gas_used",
    "has_token_transfer",  # binary
    "protocol_group",      # categorical -> encoded
    "input_data_length",
    "is_failed",           # binary
    "is_known_contract",   # binary — explicit "have we seen this contract" signal
]

CATEGORICAL_COLUMNS = ["method_category", "protocol_group"]


def load_and_prepare(path: str):
    df = pd.read_csv(path)
    print(f"Loaded {len(df)} rows from {path}")

    # Drop rows with unknown category (Gemini couldn't classify)
    df = df[df["category"].isin(CATEGORY_MAP.keys())].copy()
    print(f"After filtering valid categories: {len(df)} rows")

    df["usd_value"] = df["usd_value"].fillna(0)

    encoders = {}
    for col in CATEGORICAL_COLUMNS:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col].astype(str))
        encoders[col] = le

    df["direction"] = (df["direction"] == "incoming").astype(int)
    df["y"] = df["category"].map(CATEGORY_MAP)
    return df, encoders


def wallet_level_split(df: pd.DataFrame, test_size: float = 0.2):
    """FIX C: split by wallet_address so no wallet appears in both train
    and test. This is the single most important correctness fix in the
    plan — without it, reported accuracy is not trustworthy."""
    splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=42)
    train_idx, test_idx = next(
        splitter.split(df, groups=df["wallet_address"])
    )
    return df.iloc[train_idx], df.iloc[test_idx]


def train(train_df: pd.DataFrame):
    X_train = train_df[FEATURE_COLUMNS]
    y_train = train_df["y"]

    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        objective="multi:softprob",
        num_class=4,
        eval_metric="mlogloss",
    )
    model.fit(X_train, y_train, verbose=True)
    return model


def evaluate(model, test_df: pd.DataFrame):
    X_test = test_df[FEATURE_COLUMNS]
    y_test = test_df["y"]
    y_pred = model.predict(X_test)

    print("\n=== OVERALL (vanity metric — do not lead with this) ===")
    print(classification_report(y_test, y_pred, target_names=CATEGORY_NAMES))

    # FIX A: known-vs-unknown breakdown. This is the number that actually
    # demonstrates ML is doing work the rule engine (methodCategory /
    # protocol lookup) couldn't already do on its own.
    known_mask = test_df["is_known_contract"] == 1
    unknown_mask = ~known_mask

    print(f"\n=== KNOWN-CONTRACT subset (n={known_mask.sum()}) ===")
    print("Expect near-100% — this is mostly the model re-deriving")
    print("methodCategory/protocol_group, not new signal.")
    if known_mask.sum() > 0:
        print(classification_report(
            y_test[known_mask], y_pred[known_mask],
            target_names=CATEGORY_NAMES, zero_division=0,
        ))

    print(f"\n=== UNKNOWN-CONTRACT subset (n={unknown_mask.sum()}) ===")
    print("*** THIS is the number worth presenting to judges. ***")
    print("It's the model's accuracy on exactly the cases the")
    print("rule-based classifier.ts signature lookup cannot resolve.")
    if unknown_mask.sum() > 0:
        print(classification_report(
            y_test[unknown_mask], y_pred[unknown_mask],
            target_names=CATEGORY_NAMES, zero_division=0,
        ))

    print("\nConfusion matrix (overall):")
    print(confusion_matrix(y_test, y_pred))


def export_onnx(model, sample_input: pd.DataFrame, out_path: str):
    """FIX D: export to ONNX so inference runs in-browser via ONNX.js —
    no Python microservice to keep alive during judging."""
    try:
        from onnxmltools import convert_xgboost
        from onnxmltools.convert.common.data_types import FloatTensorType

        initial_type = [("input", FloatTensorType([None, len(FEATURE_COLUMNS)]))]
        onnx_model = convert_xgboost(model, initial_types=initial_type)
        with open(out_path, "wb") as f:
            f.write(onnx_model.SerializeToString())
        print(f"\n✅ ONNX model written to {out_path}")
    except ImportError:
        print(
            "\n⚠️ onnxmltools not installed — run "
            "`pip install onnxmltools skl2onnx` to enable ONNX export. "
            "Falling back to native XGBoost format only."
        )


def main():
    os.makedirs("models", exist_ok=True)

    df, encoders = load_and_prepare("data/labeled_dataset.csv")
    train_df, test_df = wallet_level_split(df)

    print(f"\nTrain wallets: {train_df['wallet_address'].nunique()}, "
          f"rows: {len(train_df)}")
    print(f"Test wallets: {test_df['wallet_address'].nunique()}, "
          f"rows: {len(test_df)}")

    # Sanity check: FIX C — confirm zero overlap
    overlap = set(train_df["wallet_address"]) & set(test_df["wallet_address"])
    assert not overlap, f"Wallet leakage detected: {overlap}"
    print("✅ No wallet leakage between train/test splits")

    print("\nTraining category distribution:")
    print(train_df["category"].value_counts())
    print("\nTest category distribution:")
    print(test_df["category"].value_counts())

    model = train(train_df)
    evaluate(model, test_df)

    model.save_model("models/xgboost_classifier.json")
    print(f"\n✅ Native XGBoost model saved to models/xgboost_classifier.json")

    export_onnx(model, train_df[FEATURE_COLUMNS], "models/xgboost_classifier.onnx")

    # Save encoders info for reference
    print("\n=== Encoder mappings (for mlClassifier.ts) ===")
    for col, le in encoders.items():
        print(f"{col}: {dict(zip(le.classes_, le.transform(le.classes_)))}")


if __name__ == "__main__":
    main()

# FIX E note (product copy, not code): don't claim "10 Gemini calls per
# 100 txns" anywhere in slides/README. Every classified transaction still
# needs its own description call. The true, defensible win is
# classification latency: ~500ms/API-call (Gemini-only) -> ~1ms local
# ONNX inference. State it that way.
