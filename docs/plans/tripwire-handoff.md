# Tripwire: передача разработки тиммейту

**Актуальная точка продолжения:** [tripwire-progress.md](tripwire-progress.md).
Follow-up H2a/H2b1/H2b2/H4a/H4b/H4c1 записаны 7 октября; ниже сохраняется исходный снимок 6 октября.
Каждый завершённый следующий шаг коммитится и отправляется в эту же ветку вместе
с checkpoint согласно просьбе пользователя от 7 октября.

Состояние на **6 октября 2026 года, Алматы**. Это точка продолжения разработки,
а не подтверждение готовности к mainnet. План находится в том же коммите, что
контракты, оператор, экран операций и их тесты. Ветка передачи:
`codex/tripwire-route-limits`.

## Что делаем и чего обещаем пользователю

Первый продукт: контроль USDC-платежей через наш escrow по маршруту CCTP v2
Standard Base → Ethereum. Сначала Base Sepolia → Ethereum Sepolia. Платёж
привязывает получателя, бизнес-операцию, политику клиента и фиксированный адрес
возврата. Выплата возможна после проверки источника, фактического mint и
действующей политики. Клиент может запросить отдельный возврат на заранее
заданный адрес Ethereum после установленной задержки.

Контроль относится к платежам через этот escrow. Прямые переводы казначейства,
другой bridge/mint recipient и действия владельца за пределами интеграции пока
не охвачены. Возврат в Ethereum не отменяет burn в Base и не выполняет обратный
bridge автоматически. Согласованный продуктовый контракт —
[tripwire-product.md](tripwire-product.md).

## Точная исходная точка

| Область | Уже сделано локально | Что ещё не доказано |
| :--- | :--- | :--- |
| Контракты | `CctpPaymentEscrow`, привязка source/operation/policy, ограничения получателей и сумм, задержки/approval/pause, фиксированный возврат, учёт credited/paid/returned | Независимый аудит, актуальный public deployment, реальный возврат |
| Оператор | Формат review 3, текущая политика, source/mint verification, SQLite outbox, finality/restart/quarantine, отдельные paid/rejected/returned outcomes | Работа на реальных переводах, качество живых risk inputs |
| Подготовка пилота | Публичный unsigned deployment plan, keyless preflight, точная проверка runtime, acceptance по четырём квитанциям, unsigned first-payment planner | Подпись/отправка четырёх deployment transactions и burn/mint |
| Наблюдатель | Discovery для пустого manifest v3, сохранение обеих позиций и hints, bounded catch-up, свежая проверка receipts, watch/retry/stop, атомарные публичные файлы | Supervisor, оповещения, длительная эксплуатация и более 100 hints на сеть |
| Экран | `/tripwire/operations`, импорт, поиск/фильтры, HOLD/return/receipt timelines, coverage/gaps, stale/error; чтение выбранной публичной папки | Полный ручной browser smoke с native directory picker, hosted live data |
| Публичные отчёты | Опциональное архивирование через `--keep-reports`, сохранение старых файлов, порции до 100 файлов, crash/collision guards | Освобождение места на диске и отдельная политика длительного хранения |
| Проверки | **1 294 теста / 65 файлов**, сборка/typechecks и lint прошли; локальный payment demo также прошёл | Эти проверки не являются внешним аудитом или public-network evidence |
| Клиенты | Подготовлены критерии, интервью и пилотный процесс | Контакты, интервью, партнёрские обязательства и спрос пока не подтверждены |

Новый продукт **не развёрнут** по последним зафиксированным проверкам.
Реальные burn/mint/payout/return не отправлялись. Последний локальный funding
snapshot: **6 октября, 17:37 Алматы**; четыре блокера — destination ETH для
owner/customer и oracle/operator, source ETH и source USDC. Это исторический
снимок, не текущие балансы; перед любым действием повторить keyless preflight.

Старые public demo-контракты и manifest v1/v2 не заменяют новый продукт.
Приоритетные runbooks — payment policy/operator, readiness, deployment acceptance
и first payment. `tripwire-pilot.md` описывает более ранний v2-пилот.

## Первый запуск с чистого клона

1. Получить актуальную `origin/codex/tripwire-route-limits` в своей рабочей ветке.
   Исходный коммит передачи `cc13777` отправлен и remote SHA проверен 7 октября.
   Следующие шаги читать в progress checkpoint; не продолжать с устаревшего `main`.
2. Прочитать `AGENTS.md`, затем этот файл и
   [операционный runbook](tripwire-operations.md). Соблюдать browser read-only,
   bigint money и раздельные browser/standalone operator границы.
3. Использовать Node с `node:sqlite` (runbook: 22.13+). Текущая проверенная среда:
   Node **24.19.0**, npm **11.17.0**. Поставить зависимости из lockfile:

   ```sh
   npm ci
   npm test -- --maxWorkers=2 --minWorkers=1
   npm run build
   npm run lint
   npm run tripwire:payment:demo:local
   npm run dev -- --host 127.0.0.1 --port 5177 --strictPort
   ```

4. Открыть `http://127.0.0.1:5177/tripwire/operations`. Использовать отмеченные
   synthetic fixtures из `src/testing/fixtures/tripwire/`; это не квитанции пилота.
5. Записать воспроизведённые результаты, версии среды и возникшие отличия в новой
   заметке. Скриптов `typecheck`/`test:golden` в package.json нет: typechecks идут
   через build, characterization входит в общий набор тестов.

`.tripwire/`, `.env*`, кошельки и SQLite исключены из Git. В чистом клоне **нет**
локальных ключей, concrete deployment package, receipt bundle, intent, журналов,
funding reports или скриншотов автора. Не пытаться запускать отсутствующий
`.tripwire/pilot/payment-manifest.json` и не искать приватные ключи в истории Git.
Для своей среды создать отдельные тестовые роли и public configuration version 3
по [payment operator](tripwire-payment-operator.md#deployment-package), затем новый
пакет. Для продолжения именно прежнего пилота согласовать передачу его публичной
конфигурации/receipt/intent и контроль аккаунтов вне Git; существующий intent или
журнал нельзя заменять только ради успешного запуска.

## Где продолжать в коде

| Задача | Основные файлы |
| :--- | :--- |
| Политика/возврат клиента | `contracts/evm/src/CctpPaymentEscrow.sol`, `src/chains/evm/paymentPolicy.ts`, `scripts/tripwire/testnet/paymentState.ts` |
| Достоверность backing | `src/chains/evm/cctp.ts`, `scripts/tripwire/cctp.ts`, `scripts/tripwire/sourceProof.ts` |
| Подписи/очередь/restart | `scripts/tripwire/operator.ts`, `review.ts`, `store.ts`, `testnet/cctpOperator.ts`, `runCctpOperator.ts` |
| Risk inputs и HOLD | `src/tripwire/riskScorer.ts`, `scripts/tripwire/watch.ts` |
| Deployment/первый перевод | `testnet/cctpDeployPlan.ts`, `cctpPreflight.ts`, `cctpDeploymentAcceptance.ts`, `cctpFirstPayment.ts` под `scripts/tripwire/` |
| Discovery/watch | `scripts/tripwire/testnet/cctpDiscovery.ts`, `cctpObserver.ts`, `observeCctp.ts`, `scripts/tripwire/discoveryState.ts` |
| Публичные файлы | `scripts/tripwire/testnet/reportArchive.ts`, `src/domain/reportFiles.ts` |
| Экран/импорт | `src/pages/TripwireOperations.tsx`, `operationsFeed.ts`, `src/chains/evm/operations.ts`, `src/domain/operations.ts` |

Контрактные artifacts генерируются существующим компилятором и сверяются с ним
в тестах. Не менять bytecode вручную. Изменение immutable contracts, review format,
manifest/profile или journal scope требует ADR, согласованной совместимости и
обновления соответствующих проверок/runbooks.

## Очередь реализации

### H1. Закрыть проверку папки в настоящем браузере

Это первый небольшой инженерный шаг: реализация есть, но автоматизация не могла
управлять native picker. Нужен ручной smoke, а не ещё один mock.

Создать отдельную папку только для публичных synthetic отчётов:

```sh
mkdir -p .tripwire/browser-smoke-public
cp src/testing/fixtures/tripwire/operations-worker-synthetic.json .tripwire/browser-smoke-public/observation-1000-00000000-0000-0000-0000-000000000001.json
```

В поддерживающем браузере выбрать **Follow public report folder** и эту папку.
Проверить четыре synthetic строки и исходный capture time. Затем добавить:

```sh
cp src/testing/fixtures/tripwire/operations-worker-outage-synthetic.json .tripwire/browser-smoke-public/observation-1001-00000000-0000-0000-0000-000000000002.json
```

**Done:** после следующего чтения нет прежних строк/anchors/coverage, показаны
unavailable и retry state; более новый healthy fixture возвращает строки.
Проверить повреждённый newest, его удаление без fallback, отмену permission,
Disconnect, reload, ручной импорт при активной подписке, unsupported browser и
узкий экран. Старые fixture timestamps сохранять: stale badge здесь ожидаем.
Записать браузер/версию и screenshots с явной отметкой synthetic. Не подменять
fixture на real evidence и не выбирать папку с кошельками.

### H2. Подготовить эксплуатацию наблюдателя

Сначала определить типы выхода: retryable startup RPC failure отдельно от
terminal configuration/runtime/scope/quarantine/capacity/storage failures.
Сейчас общий CLI failure не даёт supervisor надёжной классификации причин.
После этого подготовить и проверить supervisor configuration для среды команды;
не делать бесконечный restart любой ошибки. Репозиторный шаблон и его проверка —
отдельно от установки службы на машине.

Добавить наблюдаемость: нет новых отчётов, retrying, stopped/quarantined, backlog,
capacity и archive/storage failure. Порог давности не должен превращать stale
статусы в «свежие». Сначала локальные incident records/вывод; внешняя отправка
оповещений требует конкретного согласованного адресата и разрешения команды.

**Done:** process crash/RPC outage восстанавливается с тем же journal и без
повторных claims; terminal причины не обходятся рестартами; остановка освобождает
lease; metadata/ошибки не раскрывают ключи или credential-bearing RPC URLs.
Проверить disk failure после commit и publication, плюс новый запуск против того
же state. Использовать нынешние observer/crash/archive fixtures как основу.

### H3. Провести реальный testnet workflow

Владелец выполнения — назначенный человеком operator, контролирующий тестовые
аккаунты. Инженерные инструменты подготовки ниже keyless/unsigned.

1. Подготовить public configuration v3, отдельные owner/customer и oracle/operator
   роли, deployment nonce и согласованные test limits. Сохранить новые plan и
   receipt template по [readiness](tripwire-testnet-readiness.md) и
   [acceptance](tripwire-deployment-acceptance.md).
2. Получить testnet ETH на соответствующих сетях и test USDC на Base Sepolia.
   Повторить preflight; изменение deployer nonce требует целого нового пакета,
   а не ручной правки одного поля. Не считать nonzero ETH достаточным gas budget.
3. Выполнить четыре ordered deployment/configuration transactions с актуальными
   симуляциями/fees; сохранить реальные hashes и добиться finalized acceptance
   полного runtime, receipt provenance, initial policy/accounting и grant history.
4. Подготовить один first-payment intent по
   [first payment](tripwire-first-payment.md). Сохранять его operation ID и reserved
   burn nonce после начала действий. Planner выдаёт только следующий unsigned
   шаг: allowance reset / exact approval / Standard burn. Это не durable burn sender.
5. Отдельно обеспечить контролируемую подпись, полный Base fee budget, nonce и
   сохранение отправленных bytes/receipts. После burn ждать фактический mint;
   повторный burn не является способом ускорить settlement.
6. Запустить observer после acceptance. Для durable discovery использовать реальные
   decimal source/destination start blocks, empty manifest v3 и отдельный journal:

   ```sh
   npm run tripwire:cctp:observe -- manifest.json observer.sqlite --discover-resume=SOURCE_START_BLOCK:DESTINATION_START_BLOCK --watch --interval=10 --reports=public-reports --keep-reports=500
   ```

   Заменить placeholders реальными блоками. Signing operator использует собственный
   journal и explicit receipt locators: автоматическая передача discovery в подпись
   пока не реализована. Один writer на journal и один владелец account nonce.
7. Записать normal payout, customer approval/delay, policy invalidation, pause,
   HOLD→retry, recovery request→maturity→fixed return и restart/outage. Отделить
   receipt inclusion от finality и operator-added latency.

**Done:** есть реальные canonical finalized burn/mint/payout/return receipts,
exact net-credit accounting и воспроизводимые failure drills. Missing
baseline/pricing/screening сохраняет HOLD. Synthetic baseline нельзя выдавать за
живой input только для получения ALLOW. Текущие acceptance/first-payment проверки
рассчитаны на unused initial state; после первого платежа они не заменяют ongoing
operator audit. Старые артефакты, scope или SQLite quarantine не сбрасывать.

### H4. Разделить обязательную политику и behavioral shadow signals

Это открытая продуктовая работа, не существующий переключатель. Сначала записать
ADR/decision matrix: какие источники обязательны, как трактовать их outage, какие
эвристики только информируют и когда клиент явно разрешает их enforcement.
Согласовать изменения operator/scorer/review/contract policy вместе.

H4c1 фиксирует [конкретную proposed спецификацию](tripwire-behavioral-policy.md)
и ADR-038: customer consent, отдельный issuer/head/receipt screening, обязательства
review/execute и новые совместимые версии. Это design, не включённый режим.
Следующий H4c2 — pure read-only verifier; точная задача в progress checkpoint.

**Done:** отсутствующий/invalid обязательный source, mint, policy или screening
не становится ALLOW; reviewer не обходит recipient/amount/approval/pause/delay;
изменение customer policy инвалидирует старый review. Shadow вывод не обещает
«безопасность» и не выдаёт execution permission. Есть негативные fixtures для
каждой строки decision matrix и совместимости версий.

### H5. Подготовить source integration и аудит

Перечислить все outgoing paths treasury account, права operator/owner и способы
обхода escrow. Первый planner допускает EOA; smart/delegated account требует
отдельного поддерживаемого профиля и review, а не скрытой замены текущей проверки.
Определить принудительные ограничения автоматизированного sender и оставшиеся
права владельца. Затем передать внешнему аудитору pinned commit, compiler/artifact
hashes, threat model, выбранную deployment configuration и testnet evidence.

**Done:** независимые findings с reproductions, исправления и remediation review
на конкретном коммите; роли и bypass powers документированы; нет заявления
«аудит пройден» только на основании 1 294 локальных тестов.

### H6. Найти design partner и подтвердить полезность

Этот трек вести параллельно инженерии. Founder назначает владельца discovery;
команда уже обозначила бюджет на аудит/пилот, но конкретных партнёров нет.
Использовать [partner workflow](tripwire-partners.md): 30 проверенных кандидатов,
12 интервью о реальных операциях, 3 подходящих кандидата, 1 письменный testnet
pilot commitment. Это цели, не достигнутые результаты.

**Done:** подтверждены supported route, recurring pain, decision owner, access
к согласованным test operations, приемлемые delays/holds, метрики экономии времени
и критерии остановки. Outreach выполняет назначенный владелец discovery; этот commit не отправляет
приглашений. При отсутствии commitment после
интервью пересмотреть гипотезу, а не расширять число chains ради активности.

## Ограничения, которые нельзя потерять при продолжении

- Discovery: до 4 096 новых finalized blocks за tick на сеть, 100 retained hints
  на сеть. Capacity stop требует reconciliation; архив JSON не расширяет этот cap.
- Lifecycle history: bounded scans, unavailable history не заменяется guessed
  payout hash/time. Source-only hints не являются доказанным unminted balance.
- Browser: max 2 MB / 1 000 payment rows / 2 000 folder entries; read-only,
  memory-only handles, нет authenticated publisher или complete treasury inventory.
- Архив: opt-in 10–1 000 retained reports, максимум 100 moves/tick и 10 000
  top-level entries. Проверен local macOS filesystem; нужны hard links и directory
  flush support. История сохраняется, общий disk usage продолжает расти.
- RPC/Circle/admin trust остаётся. Scope/runtime equality не является consensus
  light client, аудитом Circle proxy implementation или независимым аудитом продукта.
- Mainnet: только после independent review, восстановленного testnet credit,
  failure drills, принятой source integration и partner-approved limits/runbook.

## Как сдавать следующие изменения

Каждый этап — отдельный reviewable commit/PR с триггером проблемы, итоговым
поведением, tests и конкретными ограничениями. Обновлять `docs/05-roadmap.md` и
соответствующий runbook вместе с кодом; новую архитектурную границу фиксировать
в `docs/07-decisions-adr.md`. Публичные факты отличать от synthetic examples.
Секреты, wallets, signed outbox и journal не добавлять в Git и не force-add
`.tripwire/`. Не очищать state ради обхода ошибок/quarantine.

В первом follow-up указать: воспроизведён ли baseline; результат H1; кто владеет
H2/H3/H5/H6; какой следующий acceptance gate закрывается. Это позволит продолжить
по фактам, не создавая впечатления уже работающего live pilot.
