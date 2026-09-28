import { z } from 'zod';

export const CategorySchema = z.enum([
  'transfer_in',
  'transfer_out',
  'swap',
  'liquidity_add',
  'liquidity_remove',
  'stake',
  'unstake',
  'reward_claim',
  'airdrop',
  'mint',
  'nft_trade',
  'approval',
  'bridge',
  'compression',
  'account_management',
  'contract_deploy',
  'fee_only',
  'unclassified',
]);
export type Category = z.infer<typeof CategorySchema>;

export const ClassificationSourceSchema = z.enum(['rule', 'ml', 'llm', 'fallback', 'user']);
export type ClassificationSource = z.infer<typeof ClassificationSourceSchema>;

export const ClassificationSchema = z.object({
  txId: z.string(),
  category: CategorySchema,
  confidence: z.number().min(0).max(1),
  source: ClassificationSourceSchema,
  evidence: z.array(z.string()),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const WarningSchema = z.object({
  id: z.string(),
  level: z.enum(['low', 'medium', 'high', 'critical']),
  message: z.string(),
  evidence: z.array(z.string()),
});
export type Warning = z.infer<typeof WarningSchema>;

export const StorySchema = z.object({
  txId: z.string(),
  category: CategorySchema,
  headline: z.string(),
  slots: z.record(z.string(), z.any()),
  narrative: z.string().optional(),
  confidence: z.number().min(0).max(1),
  source: ClassificationSourceSchema,
  warnings: z.array(WarningSchema),
});
export type Story = z.infer<typeof StorySchema>;
