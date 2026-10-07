# Tripwire: текущая точка продолжения

Обновлено **7 октября 2026 года, Алматы**. Ветка: `codex/tripwire-route-limits`.
Основной план и ограничения: [handoff](tripwire-handoff.md).
Этот файл обновляется в каждом завершённом шаге вместе с кодом и проверками.
Текущий коммит файла определяется через `git log -1 -- docs/plans/tripwire-progress.md`;
не нужно вставлять в коммит его собственный будущий hash.

## Завершённый шаг: H2a — причины завершения keyless observer

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

## Следующий инженерный шаг: H2b

**Не устанавливать автоматический бесконечный restart сейчас.** Завершена H2a,
а не вся эксплуатация H2. В уже запущенном watch ещё есть legacy catch для
неразмеченных exceptions, который делает unavailable/retry: startup exit contract
не доказывает классификацию всех внутренних storage/evidence failures.

1. Проследить untyped failures в `cctpAudit.ts`/`cctp.ts`/`store.ts`, discovery и
   payment-state reads. Отдельно проверить journal write во время authenticated
   proof commit, quarantine write и lease close; ошибки локального state не должны
   переходить в RPC retry. Не выдавать malformed/contradictory provider evidence
   за доказанное outage. Сохранять per-payment HOLD/unavailable там, где это
   безопасный существующий результат, а не авария всего процесса.
2. Ввести согласованную классификацию running incidents без изменения execution
   permission, review format, manifest/journal scope и без вывода raw exceptions.
   Сначала regression fixtures, затем реализация; отразить совместимость в ADR.
3. Только после этого подготовить repo supervisor template/harness для среды
   команды. Restart разрешать по exit 75 и явному crash policy с ограничением
   частоты; 70/74/78 требуют разбирательства. Прямой Node/tsx entrypoint должен
   сохранять exit code; не полагаться на оболочку, скрывающую его.
4. Добавить локальные incident records/наблюдение: report age, retrying, stopped,
   quarantine, backlog/capacity и publication/archive failures. Report capture
   time не обновляется по факту проверки файла. Внешние уведомления без конкретного
   получателя и разрешения не отправлять.
5. Done: synthetic process crash/RPC outage → тот же scoped journal без повторных
   claims; terminal error не обходится restart; SIGTERM освобождает lease;
   storage failure до/после publication не теряет состояние. Проверить реальные
   subprocess exits, bounded restart и редактирование credential-bearing причин.

## Остальные gates

| Шаг | Статус / что требуется |
| :--- | :--- |
| H1 | Открыт: ручной native directory picker smoke по handoff; mock/controller tests не закрывают этот gate |
| H2a | Реализован и проверен локально; supervisor/incident monitoring ещё отсутствуют |
| H2b | Следующий инженерный шаг выше; runtime failure classification + supervision + local incidents |
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
