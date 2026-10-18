# Building Nazar on Arkiv: friction log

These are notes taken while building, with dates. Each entry says what we expected, what happened, how to reproduce it, what it cost us, and what would have helped.

**Versions:** `@arkiv-network/sdk` 0.8.0 and `viem` 2.57.7 (backend and web app, from the lockfiles), Node 24.14.0, Tiramisu testnet (chain `7738577`) over the public HTTP RPC, no access key.

**How each item was found:** "hit live" means it happened to us against Tiramisu. "From the SDK" means we read it in the SDK's types or JSDoc and designed around it, without a live probe. Each item says which.

## 1. A write from an unfunded wallet fails with "Execution error without revert data" (16 Oct)

- **Found:** hit live.
- **Expected:** an error that says the wallet has no funds for gas.
- **What happened:** we called `createEntity` from a fresh wallet holding 0 GLM. It threw `EntityMutationError: Transaction failed: Execution error without revert data`, with `txHash: undefined`. Patching an entity that doesn't exist gives the same message.
- **Repro:** `pnpm cli wallet:new` (in `Nazar-backend/`), point `NAZAR_PUBLISHER_PRIVATE_KEY` at the new, unfunded key, and call `createEntity` with any valid entity. Separately, from a funded wallet, call `patchEntity` with a random 32-byte `entityKey`. Both throw the same message.
- **Cost:** two different problems produce the same error. We had to capture the raw JSON-RPC traffic and run `eth_estimateGas` and `eth_call` ourselves to tell "no funds" apart from "bad operation".
- **Would help:** have the SDK check the balance before sending and say "insufficient GLM for gas (need ~X)". Decode the registry's revert reasons, such as "entity not found".

## 2. The faucet can't be scripted (16 Oct)

- **Found:** hit live.
- **Expected:** a way to fund a server-side wallet without a browser.
- **What happened:** hub.arkiv.network/faucet needs a wallet sign-in (SIWE) plus a CAPTCHA.
- **Repro:** open <https://hub.arkiv.network/faucet> without a browser wallet. There is no API or CLI path.
- **Cost:** a pipeline running on a server has its own fresh key and no browser wallet. Someone has to fund it by hand, which also slows down setting up CI.
- **Would help:** a rate-limited faucet endpoint tied to an access key, for example one drip per key per day.

## 3. Key prediction is fragile under concurrency (16 Oct)

- **Found:** from the SDK (its docs say so); we designed around it rather than hitting it live.
- **Expected:** keys that depend only on the batch being sent.
- **What happened:** `predictEntityKeys` derives keys from the account nonce. Any create that lands first changes the predicted keys. It pushes every multi-entity write (notice → alerts) into a single-writer design.
- **Repro:** call `predictEntityKeys` for a batch, send one unrelated `createEntity` from the same wallet, then send the batch. Its keys no longer match the prediction.
- **Cost:** every write from the publisher wallet (publish, retraction, heartbeat) is serialised behind one in-process lock, `withWriterLock` in `Nazar-backend/src/arkiv/publisher.ts`.
- **Would help:** salt-only keys that don't depend on the nonce, or a batch-local placeholder that the engine resolves within the same transaction.

## 4. 128-byte string limit on attribute values (16 Oct)

- **Found:** hit live.
- **Expected:** the limit stated in the attributes docs.
- **What happened:** Indian product names and manufacturer addresses often run past 128 bytes, for example "Calcium Carbonate 500 mg + Vit. D3 250 IU Tablets IP (CALXIA-500)" plus the full address. The SDK throws `InvalidValueError`, though the message does helpfully suggest the payload.
- **Repro:** `createEntity` with an attribute `str('…')` longer than 128 UTF-8 bytes. The SDK throws before sending.
- **Cost:** we keep short slugs in attributes and the long form in the payload, which needed a byte-safe truncation helper (`short()` in `Nazar-backend/src/arkiv/schema.ts`).
- **Would help:** state the limit in the attributes section of the docs, not only in the error text.

## 5. No expiry callback in `watchEntityEvents` (16 Oct)

- **Found:** from the SDK. We read this in the 0.8.0 type definitions. We did not ship a WebSocket watcher and did not probe this live.
- **Expected:** a callback when an entity reaches its expiry block, so a client can react when the heartbeat lapses.
- **What happened:** the `watchEntityEvents` handlers in 0.8.0 are `onEntityCreated`, `onEntityPatched`, `onExpiryExtended`, `onOwnershipTransferred` and `onEntityDeleted`. None is documented as firing on expiry, and the docs don't say whether expiry surfaces as `onEntityDeleted`.
- **Repro:** see the `watchEntityEvents` handler types in `node_modules/@arkiv-network/sdk/dist/*.d.ts`.
- **Cost:** we chose polling. The web app re-reads the heartbeat entity every 2 minutes (`STATUS_REFRESH_MS` in `Nazar-frontend/components/nazar/app-shell.tsx`). Once it has expired, the query returns nothing and the app shows "Pipeline offline".
- **Would help:** an `onEntityExpired` handler, or a sentence in the docs on how expiry appears to watchers.

## 6. The access key shown in the hub is masked (16 Oct)

- **Found:** hit live.
- **Expected:** a copyable key, and a note on whether the public RPC needs one.
- **What happened:** the RPC page shows the key as `ark_live_t4RK…yGiQ`, and that masked text is what got copied into our notes.
- **Cost:** we couldn't tell at first whether the public RPC needs a key. It doesn't: reads and gas estimates work without one.
- **Would help:** a clear "copy full key" action, and one sentence saying the key is optional and only raises rate limits.

## 7. Real alerts cost about 210k gas per create, not 136k (17 Oct)

- **Found:** hit live (measured with `eth_estimateGas`).
- **Expected:** a cost per alert close to our first measurement.
- **What happened:** our first measurement, about 136k gas per create, used a tiny test entity. We then ran `eth_estimateGas` on real 12-alert batches from the ledger: 25 attributes and a ~1 KB JSON payload each. That came to about 2.5M gas and about 71 KB of calldata per batch, roughly 210k gas per alert. The cause is the encoding: each attribute is an ABI tuple `(bytes32 name, uint8 type, bytes value)`, about 160 bytes of words before the value, so the attributes outweigh the payload.
- **Repro:** `pnpm cli arkiv:validate` in `Nazar-backend/` builds every alert from the ledger and runs `eth_estimateGas` on a sample of real batches, with no funds needed.
- **Cost:** our balance pre-check under-reserved gas by about 35 %. Our first calldata estimate was off by 2.5×.
- **Would help:** a per-attribute gas and calldata figure in the docs, or an SDK `estimateBatch()` that returns gas and encoded size without a signer.

## 8. Estimating gas without funds needs a calldata-capturing transport (17 Oct)

- **Found:** hit live.
- **Expected:** an SDK call to price a write before the wallet is funded.
- **What happened:** the SDK has no `simulate`/`estimate` action. To price a publish before the wallet was funded, we built the batch through a custom viem transport. The transport refuses `eth_fillTransaction`/`eth_estimateGas` and records the `to` and `data` the SDK produced. We then call `eth_estimateGas` on that ourselves. An empty sender works, because no fee fields are sent.
- **Repro:** the workaround transport is in `Nazar-backend/src/arkiv/publisher.ts` (search for `eth_fillTransaction`).
- **Cost:** about an hour, plus a hack that depends on SDK internals: which RPC method the SDK calls first.
- **Would help:** `client.estimateExecuteBatch({ creates, … })`, or an `encodeExecuteBatch()` that returns calldata, so tools can dry-run and price writes.

## 9. `extendEntity` sets, it doesn't add, and a shorter extension is an error (17 Oct)

- **Found:** from the SDK's JSDoc, while building the keep-alive client.
- **Expected:** "extend by N days" to add N days to the current expiry.
- **What happened:** the JSDoc says an extension sets a new expiry from now, and the engine rejects one that would not move the expiry later. A "+N days" Keep Alive button that sends `fromDays(N)` therefore fails whenever the alert has more than N days left.
- **Repro:** create an entity with `ExpirationTime.fromDays(30)`, then call `extendEntity` with `ExpirationTime.fromDays(7)`.
- **Cost:** our keep-alive client now reads `expiresAt` and the current block (`getBlockTiming`) first, and skips no-op extensions.
- **Would help:** an `ExpirationTime.extendBy(days)` helper that resolves against the entity's current expiry, or a clearer revert reason than a generic execution error.

## 10. Telling "expired" from "RPC hiccup" before re-creating a heartbeat (17 Oct)

- **Found:** while building the heartbeat worker.
- **Expected:** a write error that says whether the entity is gone.
- **What happened:** the heartbeat is renewed with `patchEntity` + `extendEntity`. When the patch fails we must decide: recreate the entity (it expired) or retry later (network error)? The patch error does not say which. We call `getEntity` and only recreate on `NoEntityFoundError`.
- **Repro:** `patchEntity` on an expired heartbeat key, and on a live key while the RPC is unreachable. Both fail without saying which case it is. The handling is in `Nazar-backend/src/arkiv/heartbeat.ts`.
- **Cost:** one extra read per failed beat, and a near miss: an earlier version created a duplicate heartbeat on any failure.
- **Would help:** a typed `EntityNotFound`/`EntityExpired` mutation error from the write path.

## 11. `page.next()` fails once new blocks arrive (18 Oct)

- **Found:** hit live.
- **Expected:** `page.next()` to return the next page of the same result set.
- **What happened:** we paged through our 1,144 live alerts with `page.next()`. The second page failed with `QueryError (cursor, -32005): cursor belongs to a different query, block or select — start a new page-through`. The first page was read at block N, `next()` sent only the cursor, and the node evaluated it at the new head.
- **Repro:** run any query with `.limit(50)` that has more than one page, wait at least one block (about 2 seconds), then call `page.next()`.
- **Cost:** our "Load more" in the Feed and the backend's full scans broke as soon as a block passed between pages. On a 2-second chain, that is almost always.
- **Fix we use:** rebuild the query with `.atBlock(page.blockNumber).cursor(page.cursor)` (`Nazar-backend/src/arkiv/reader.ts`, `Nazar-frontend/lib/source/arkiv.ts`, `arkiv/queries/feed.ts`).
- **Would help:** have `page.next()` pin the block automatically, since a cursor is only valid at one block. At least mention this in the pagination docs.

## What worked well

- **Typed values:** `i32`, `u64` and `key` attributes, plus the query builder (`eq`, `gte`, `createdBy`, and cursor pagination once pinned with `atBlock`, see #11), made the batch lookup and range queries straightforward.
- **Creation flags:** `readonly` plus `permissionlessExtension` match our product rules exactly: alerts can't be edited, and anyone can keep one alive.
- **Atomic notices:** `executeBatch` with predicted keys let a notice and its alerts land atomically, already linked.
- **Cost:** a bare create is about 136k gas. A real alert (25 attributes, ~1 KB payload) is about 210k gas, and a 12-alert batch about 2.5M gas. At 1 gwei that is about 0.0002 GLM per alert.
- **Read path:** reads through the public RPC need no key, so the web app can check a batch directly against Arkiv even when every Nazar server is down.
