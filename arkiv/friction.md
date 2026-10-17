# Building Nazar on Arkiv: friction log

These are notes taken while building, with dates. Each entry says what happened, what it cost us, and what would have helped.

## 1. A write from an unfunded wallet fails with "Execution error without revert data" (16 Oct)

- **What happened:** we called `createEntity` from a fresh wallet holding 0 GLM. It threw `EntityMutationError: Transaction failed: Execution error without revert data`, with `txHash: undefined`. Patching an entity that doesn't exist gives the same message.
- **Cost:** two different problems produce the same error. We had to capture the raw JSON-RPC traffic and run `eth_estimateGas` and `eth_call` ourselves to tell "no funds" apart from "bad operation".
- **Would help:** have the SDK check the balance before sending and say "insufficient GLM for gas (need ~X)". Decode the registry's revert reasons, such as "entity not found".

## 2. The faucet can't be scripted (16 Oct)

- **What happened:** hub.arkiv.network/faucet needs a wallet sign-in (SIWE) plus a CAPTCHA.
- **Cost:** a pipeline running on a server has its own fresh key and no browser wallet. Someone has to fund it by hand, which also slows down setting up CI.
- **Would help:** a rate-limited faucet endpoint tied to an access key, for example one drip per key per day.

## 3. Key prediction is fragile under concurrency (16 Oct)

- **What happened:** `predictEntityKeys` derives keys from the account nonce. Any create that lands first changes the predicted keys. The docs say so, but it pushes every multi-entity write (notice → alerts) into a single-writer design.
- **Cost:** we serialise all writes behind an in-process mutex and use one wallet per duty.
- **Would help:** salt-only keys that don't depend on the nonce, or a batch-local placeholder that the engine resolves within the same transaction.

## 4. 128-byte string limit on attribute values (16 Oct)

- **What happened:** Indian product names and manufacturer addresses often run past 128 bytes, for example "Calcium Carbonate 500 mg + Vit. D3 250 IU Tablets IP (CALXIA-500)" plus the full address. The SDK throws `InvalidValueError`, though the message does helpfully suggest the payload.
- **Cost:** we keep short slugs in attributes and the long form in the payload, which needed a byte-safe truncation helper.
- **Would help:** state the limit in the attributes section of the docs, not only in the error text.

## 5. Expiry fires no WebSocket event (16 Oct)

- **What happened:** `watchEntityEvents` reports created, updated, deleted and extended events. An entity that simply reaches its expiry block emits nothing.
- **Cost:** the app has to re-check `$expiresAt` on a timer to notice an alert that has aged out, or a heartbeat that stopped.
- **Would help:** an `EntityExpired` event, or at least a documented polling pattern.

## 6. The access key shown in the hub is masked (16 Oct)

- **What happened:** the RPC page shows the key as `ark_live_t4RK…yGiQ`, and that masked text is what got copied into our notes.
- **Cost:** we couldn't tell at first whether the public RPC needs a key. It doesn't: reads and gas estimates work without one.
- **Would help:** a clear "copy full key" action, and one sentence saying the key is optional and only raises rate limits.

## What worked well

- **Typed values:** `i32`, `u64` and `key` attributes, plus the query builder (`eq`, `gte`, `createdBy`, cursor `next()`), made the batch lookup and range queries straightforward.
- **Creation flags:** `readonly` plus `permissionlessExtension` match our product rules exactly: alerts can't be edited, and anyone can keep one alive.
- **Atomic notices:** `executeBatch` with predicted keys let a notice and its alerts land atomically, already linked.
- **Cost:** one alert costs about 136k gas, and a batch of 10 about 1.36M gas.
- **Read path:** reads through the public RPC need no key, so the web app can check a batch directly against Arkiv even when every Nazar server is down.
