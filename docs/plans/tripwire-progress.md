# Tripwire: текущая точка продолжения

Обновлено **7 октября 2026 года, Алматы**. Ветка: `codex/tripwire-route-limits`.
Основной план и ограничения: [handoff](tripwire-handoff.md).
Этот файл обновляется в каждом завершённом шаге вместе с кодом и проверками.
Текущий коммит файла определяется через `git log -1 -- docs/plans/tripwire-progress.md`;
не нужно вставлять в коммит его собственный будущий hash.

## Завершённый шаг: H2b1 — ошибки во время наблюдения

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

## Следующий инженерный шаг: H2b2 — supervision и local incidents

**H2 целиком ещё не закрыт.** Классификация H2a/H2b1 проверена; следующий шаг
должен проверять управление настоящим дочерним процессом, а не только tick mocks.

1. Подготовить repo supervisor template/harness для среды
   команды. Restart разрешать по exit 75 и явному crash policy с ограничением
   частоты и общим лимитом попыток; 70/74/78 требуют разбирательства. Прямой Node/tsx entrypoint должен
   сохранять exit code; не полагаться на оболочку, скрывающую его.
2. Проверить process crash/RPC outage → тот же scoped journal без повторных
   claims; terminal error не обходится restart. При SIGTERM дождаться остановки
   child и освобождения lease до нового старта; чистый exit 0 не перезапускать.
   Включить failure до/после publication и bounded retry exhaustion. Реальные
   subprocess fixtures использовать с synthetic RPC/receipts, не с ключами.
3. Добавить локальные incident records/наблюдение: report age, retrying, stopped,
   quarantine, backlog/capacity и publication/archive failures. Report capture
   time не обновляется по факту проверки файла. Внешние уведомления без конкретного
   получателя и разрешения не отправлять.
4. Done: воспроизводимый supervisor harness и редактирование credential-bearing
   причин, terminal failure действительно останавливает управление, outage/crash
   восстанавливается в пределах лимита. Repo template не означает установку службы
   на машине или успешный live pilot. Документировать запуск/остановку/reconciliation.

## Остальные gates

| Шаг | Статус / что требуется |
| :--- | :--- |
| H1 | Открыт: ручной native directory picker smoke по handoff; mock/controller tests не закрывают этот gate |
| H2a | Реализован и проверен локально; supervisor/incident monitoring ещё отсутствуют |
| H2b1 | Реализован: runtime failure classification и защита journal failures от retry |
| H2b2 | Следующий инженерный шаг выше: supervised child process, crash drills, local incidents |
| H3 | Открыт: назначенный человек с тестовыми аккаунтами, финансирование, реальные finalized deployment/burn/mint/payout/return receipts |
| H4 | Открыт: ADR/decision matrix обязательной политики и behavioral shadow |
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
