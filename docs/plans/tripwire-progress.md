# Tripwire: текущая точка продолжения

Обновлено **7 октября 2026 года, Алматы**. Ветка: `codex/tripwire-route-limits`.
Основной план и ограничения: [handoff](tripwire-handoff.md).
Этот файл обновляется в каждом завершённом шаге вместе с кодом и проверками.
Текущий коммит файла определяется через `git log -1 -- docs/plans/tripwire-progress.md`;
не нужно вставлять в коммит его собственный будущий hash.

## Завершённый шаг: H4b — optional advisory report и read-only viewer

Исходная точка: `fd89814`, отправлена и проверена на GitHub. ADR-037 и
[report/display contract](tripwire-operations.md#behavioral-advisory-reports-and-viewer-adr-037)
описывают optional per-payment `behavioral` version 1. Строгая domain union
содержит reported H4a assessment либо unavailable с fixed reason и без scores.
Обёртка использует существующий projector; нового scorer или provider нет.

Actual keyless customer observer всегда экспортирует assessment-not-produced,
включая per-payment state outage: behavioral assessment у него пока отсутствует.
Reported form поддерживается importer и synthetic fixture, но live producer не
добавлен. Старые reports без extension остаются валидными и показывают отсутствие,
не zero risk. Route/canonical messageId/synthetic marker совпадают с parent report;
checkedAt равен observedAt, округлённому вниз до Unix seconds. Original capturedAt
сохраняется; проверка этих caller fields не аутентифицирует источник assessment.

Payment details показывают отдельный **Behavioral signals · Advisory only**
panel. Отображаются original indicators/capture/age и fixed missing reasons.
Stale/future assessment, browser clock behind export и ранее suppressed scores
не отображаются как usable. Существующий 30-second timer обновляет display age;
background throttling может задержать update. Это не execution clock/TTL.
Старые данные полностью заменяются при outage/refusal/scope change/explicit absence;
платёжные states, mandatory blockers, exact money и receipt references сохраняются.

Проверки: **1 496 тестов / 72 файла**, **36 новых**. Build/typechecks и lint прошли.
Actual synthetic audit → exclusive public file → import, per-row state outage,
existing scorer projection/redaction с unchanged HOLD, old/new report compatibility,
scope/provenance/check clocks/version/injection refusal, stale/future boundaries,
folder replacement и rendered read-only UI покрыты fixtures. In-app browser smoke:
synthetic aged signals, explicit absence, malformed import clearing, global outage,
desktop и 390px layout. Native folder picker не проверяли; H1 остаётся открыт.
Скриншоты smoke локальны `/tmp/tripwire-h4b/`, не Git/live evidence.

Scorer/Watcher/review/attestor/signing operator/contracts/artifacts, format 3/domain 2,
manifest/journal/SQLite и execution policy не изменены. Нет public RPC, чтения ключей,
deployment/payment, live calibrated behavioral producer, службы или внешнего аудита.
**H4b завершён локально; H4 целиком открыт.** Следующий H4c1 — concrete policy design
перед согласованной execution separation. Shadow-only execution не включён.

## История: H4a — decision matrix и read-only behavioral model

Исходная точка: `ee7e926`, отправлена и проверена на GitHub. Добавлены
[матрица/runbook](tripwire-decision-matrix.md) и ADR-036: обязательные source/mint/
customer/recipient/amount/approval/pause/delay/recovery/screening gates, их
missing/malformed/outage/expiry outcomes, роли владельцев и существующие
негативные fixtures. Size/velocity/contract heuristics описаны отдельно от
обязательного backing и screening; новая configurable execution policy не введена.

`src/domain/behavioralShadow.ts` задаёт строгую version-1 display-only схему;
`src/tripwire/behavioralShadow.ts` проецирует только три уже рассчитанных сигнала.
Нет второго scorer, I/O, чтения часов, подписи, guardian tier или вызова release
decision. Обязательные сигналы не копируются. Scope проверяется по исходным
route/transfer; caller передаёт original capture time, check time и synthetic
marker. Эти поля не доказывают достоверность или полноту исходного assessment.

Missing/invalid/duplicate сигналы остаются unavailable с `score: null`.
Stale/future capture подавляет все scores; повторная проверка не освежает время.
Фиксированы `enforcement: false`, `authorization: none`,
`executionPolicy: legacy-enforced`; ALLOW/signature/aggregate verdict и неизвестные
поля отвергаются. Standalone synthetic fixture не является operations report.

Проверки: **1 460 тестов / 70 файлов**, **39 новых**. Build/typechecks и lint
прошли. Fixtures проверяют scope/clock/expiry boundaries, недоступные и malformed
сигналы, запрещённые execution/mandatory поля, отсутствие raw reasons и мутации.
Differential cases сохраняют исходные HOLD/REJECT при сбоях source/backing/
screening/baseline/price. Контракты, scorer, Watcher, attestor, operator, review
format/domain, reports и journal не изменены. Нет public RPC, ключей, deployment,
payment или внешнего аудита.

**H4a завершён в repo; H4 целиком открыт.** Модель ещё не подключена к экспортам
и UI. Keyless observer пока не рассчитывает behavioral assessment: следующий
H4b должен честно показывать availability, без выдуманной baseline или scores.
Shadow-only execution не включён; H4c требует отдельного согласованного policy
design, обязательного screening provenance/freshness и совместимого execution.

## История: H2b2 — управление процессом и локальные события

Исходная точка: `3c0fac2`, отправлена и проверена на GitHub. Добавлены
`tripwire:cctp:supervise`, строгая public-path конфигурация и repo example.
Запускается ровно keyless observer через прямой Node/tsx, без shell или signing
entrypoint. Пути разрешаются относительно файла конфигурации; incident/report
папки отделены от manifest/journal. В child проходят только RPC transport и
минимальное OS окружение, без wallet variables/NODE_OPTIONS/HOME.

Restart допускается для exit 75; SIGKILL/SIGABRT/SIGSEGV/SIGBUS — только при
явном `restartOnCrash: true`. Exit 0 не повторяется; 70/74/78 и остальные
числовые ошибки terminal. Бюджет 0–10 дополнительных запусков, exponential
delay 1–300 секунд; бюджет не сбрасывается между child launches. Исчерпание —
78, human reconciliation; новый manual supervisor run начинает новый бюджет,
поэтому бесконечный внешний restart wrapper запрещён runbook. Watch RPC polling
остаётся отдельным прежним capped backoff, не процессным restart.

Supervisor ждёт exit и stdio closure до следующего child. SIGINT/SIGTERM
прерывает backoff, отправляет SIGTERM дочернему процессу и ждёт cleanup.
Превышение grace → SIGKILL, incident и terminal 78, без restart.
Отдельная OS-released SQLite lease в private incident directory исключает
двух supervisors там; существующие operator journal/schema/lease не меняются.
Ошибка публикации incident останавливает child, ждёт closure и даёт 74.

Локальные immutable incident JSON/NDJSON содержат только runId/time и fixed
process/report condition fields. Raw stderr/ошибки/URL/пути/body reasons/платёжные
строки не копируются. Monitor переиспользует public adapter и filename codec,
проверяет newest snapshot до 2 MB / 10 000 top-level entries, scope/ties/deletion/
nonregular refusal. Отмечает исходную давность/future, retrying/stopped/quarantine,
discovery backlog/gaps/capacity; повторная проверка файла не освежает capture time.
События пишутся на переходах состояния; пустой conditions не доказывает liveness,
исполнение или полноту treasury. Incident files сохраняются, общий disk usage растёт.

Проверки: **1 421 тест / 69 файлов**, **58 новых**. Build/typechecks и lint прошли.
Actual Node/tsx subprocesses проходят audit/discovery/SQLite/export с synthetic
serialized RPC ports (не выбираются production CLI). Проверены startup outage,
SIGKILL до/после публикации, same-journal proof/cursor без дублей, durable quarantine,
journal fault после commit, publication/archival failures до/после public export,
реальные backoff/abort/SIGTERM/forced timeout, finite exhaustion, spawn/diagnostic
redaction и actual CLI incidents/lease exclusion/reuse. Monitor fixtures проверяют
давность, состояния, retained capacity/backlog, newest refusal и recovery dedup.
Нет public RPC/deployment/payment, чтения ключей или внешнего аудита.

**Repo часть H2b2 завершена. H2 operational gate целиком не закрыт:** службу не
устанавливали, командный host/process manager и live deployment не проверяли.
SIGKILL самого parent не может остановить surviving child: менеджер среды должен
проверять/останавливать всё дерево; child продолжает удерживать journal lease.
Это ограничение, Windows/power-loss acceptance, disk budgeting/incident retention
и external alerts требуют отдельного владельца и среды. Подробный запуск/stop/
reconciliation: [runbook ADR-035](tripwire-operations.md#bounded-observer-supervision-and-local-incidents-adr-035).

## История: H2b1 — ошибки во время наблюдения

Исходная точка: `92d36c7`, отправлена и проверена на GitHub. Устранён legacy
catch, который повторял неизвестные глобальные ошибки как RPC outage, и ошибка
source adapter, которая скрывала отказ записи proof под per-payment unavailable.

Теперь все чтения/записи proof, quarantine, discovery и watcher health на пути
keyless observer имеют локальную journal boundary. Даже transport-shaped ошибка
внутри этой boundary — terminal `journal`, а не RPC retry. Подтверждение/позиция,
уже записанные до сбоя, сохраняются и читаются следующим запуском. Неизвестные
глобальные ошибки, invalid configuration/scope, capacity, malformed/contradictory
global evidence и deployment/runtime останавливают watch с пустым failure report.
Повторяются только распознанные временные RPC failures и явно проверенное
отставание finalized head (`rpc-behind`). Последнее не сбрасывает позиции.

Несогласованный finalized customer-policy snapshot уходит в durable quarantine;
неудачная запись quarantine даёт journal stop, а не утверждение об успешном
карантине. Known journal failure не скрывается одновременной отменой. Обычная
SIGINT/SIGTERM отмена остаётся чистой. Отсутствующие/испорченные данные отдельного
платежа по-прежнему могут давать HOLD/unavailable без proof/ALLOW; это отдельный
безопасный результат, не утверждение о здоровой оплате. Результат сканирования
`ok` не означает, что все строки verified или что процесс работает сейчас.

CLI сохраняет точную running reason в фиксированной stderr JSON-диагностике:
75 — `rpc-unavailable`/`rpc-behind`, 78 — journal/evidence/configuration/scope/
capacity/quarantine/deployment, 70 — internal, 74 — publication. Контракты,
review/manifest/report formats и SQLite schema не изменены. Общая реализация
failure types находится в `scripts/tripwire/auditFailure.ts`; старый
`testnet/cctpAuditFailure.ts` только re-export для совместимости, не второй путь.

Проверки: **1 363 теста / 67 файлов**, включая **32 новых** случая. Build/typechecks
и lint прошли. Fault fixtures проверяют сбои до/после proof/discovery/quarantine
commit, позднее чтение proof, same-journal restart без повторных claims,
malformed/unknown global failures, typed outage/recovery/lag, per-payment HOLD,
finalized policy conflict, cancellation/cleanup и точные one-shot running exits.
Два новых signing-operator fixture случая также проверяют: journal failure до/после
proof commit проходит через Watcher без превращения в HOLD, останавливает tick до
signature/outbox/publication, а same-journal restart продолжает исходную очередь.
Все chain данные synthetic. Supervisor, local incidents и реальные crash drills
в управляемом child process ещё не реализованы; live pilot не запускался.

## История: H2a — причины завершения keyless observer

Исходная точка: `cc13777`, отправлена на GitHub. До этого CLI отдавал общий exit 1:
supervisor не мог отличить временный отказ startup RPC от конфигурации/журнала.

Теперь `observeCctp.ts` выдаёт фиксированную JSON-диагностику в stderr и отдельный
exit code. Код 75 разрешён только для распознанного временного RPC-сбоя внутри
помеченной сетевой границы startup: timeout, transport без HTTP status, 408/429/5xx
или typed RPC limit. Неправильная сеть/HTTP URL, контракт, runtime, журнал и
quarantine не дают автоматического restart. Ошибки сохранения/архива — 74.
Неизвестный startup exception — 70, не предположение о сетевом сбое.

Причины/коды и ограничения описаны в
[операционном runbook](tripwire-operations.md#observer-process-exit-contract-adr-033).
Raw errors/causes остаются внутри процесса и не попадают в эту диагностику.
Startup acceptance по-прежнему происходит до открытия журнала. Если canonical
startup recheck упал после открытия, lease освобождается. Committed discovery
сохраняется после publication failure и читается при следующем запуске.
Изменение проверяемого deployment/runtime во время watch останавливает polling.

Проверки: **1 331 тест / 66 файлов**, включая **37 новых** fixture-based случаев
и настоящий subprocess CLI для terminal configuration. Build/typechecks и lint
прошли. Среда: Node 24.19.0, npm 11.17.0. Все новые chain данные synthetic;
нет public deployment/payment, чтения ключей или внешнего аудита.

## Следующий независимый инженерный шаг: H4c1 — policy design и compatibility contract

H1 требует ручного picker smoke; operational H2 и live H3 зависят от назначенного
оператора/среды/реальных deployment и receipt evidence. Пока эти gates открыты,
следующий автономный repo шаг — H4c1, без funding или ослабления execution.

1. Прочитать matrix/ADR-036/037, current scorer/Watcher/review/attestor/operator,
   payment policy codecs и contract constraints. Создать конкретный proposed
   `tripwire-behavioral-policy.md` и ADR: mandatory source/mint/customer/guardian
   checks отдельно от трёх initially advisory сигналов. Зафиксировать exact
   current-vs-target behavior, а не считать новый режим уже согласованным/включённым.
2. Описать mandatory screening evidence: provider/list identity и version, address/
   route binding, capture/expiry, positive/negative/unknown/contradictory outcomes,
   outage и rotation. Текущая boolean observation и static-list freshness не
   достаточны для нового provenance contract; missing/invalid/stale → HOLD.
   Не выбирать платного поставщика или делать юридические claims без основания.
3. Описать явное customer consent, policy hash/version, обязательства review,
   mutable policy invalidation и migration/rollout. Отсутствие behavioral baseline/
   price может перестать блокировать только в отдельном совместимом режиме после
   implementation/review; screening, backing и customer limits не становятся optional.
   Не добавлять switch, автоматически превращающий прежний HOLD в ALLOW.
4. Acceptance: reviewable field/decision/compatibility matrix со всеми unknown/
   expiry/rotation/replay cases, trust owners и точным следующим H4c2 implementation
   gate. Если добавлены pure types/schema — meaningful negative fixtures; current
   execution остаётся legacy-enforced. Обновить docs/checkpoint, проверки,
   commit/normal push и сверку remote SHA. Реальный rollout/live/audit gates отдельно.

## Остальные gates

| Шаг | Статус / что требуется |
| :--- | :--- |
| H1 | Открыт: ручной native directory picker smoke по handoff; mock/controller tests не закрывают этот gate |
| H2a | Реализован и проверен локально; startup/exit taxonomy |
| H2b1 | Реализован: runtime failure classification и защита journal failures от retry |
| H2b2 | Repo supervisor/crash drills/local incidents реализованы; host/service/process-tree/live acceptance остаются открытыми |
| H3 | Открыт: назначенный человек с тестовыми аккаунтами, финансирование, реальные finalized deployment/burn/mint/payout/return receipts |
| H4 | H4a matrix/model и H4b optional advisory report/viewer реализованы локально; следующий H4c1 concrete policy design; execution separation остаётся открытой |
| H5 | Открыт: source bypass integration и независимый аудит конкретного коммита |
| H6 | Открыт: discovery owner, интервью и реальный design-partner commitment |

В новом клоне отсутствуют `.tripwire` packages/keys/journals. Не считать старый
funding snapshot текущим балансом; не регенерировать существующий intent/journal
ради обхода ошибки. Новый escrow остаётся undeployed по зафиксированной evidence.

## Правило передачи следующему агенту

Проверить ветку, состояние рабочей папки и remote; прочитать AGENTS/handoff/этот
checkpoint. Завершать по одному проверяемому шагу. В каждом шаге обновлять этот
файл (что сделано, что проверено, точные ограничения, следующий acceptance gate),
roadmap и затронутый runbook; затем commit и normal push в согласованную ветку.
После push сверять полный local SHA с remote SHA. Не force-push и не включать
чужие незавершённые изменения. Список здесь описывает факты разработки, а не
живую службу, завершённый testnet пилот или аудит.
