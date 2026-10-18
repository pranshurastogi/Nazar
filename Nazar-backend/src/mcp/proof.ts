import { NoEntityFoundError, type PublicArkivClient } from '@arkiv-network/sdk'
import type { Hex } from 'viem'

import { toDirectoryEntity, type DirectoryEntity } from '../arkiv/directory.ts'
import { PROJECT } from '../arkiv/schema.ts'

/**
 * arkiv_proof: reads one entity straight from Arkiv by its key, with nothing from Nazar's ledger,
 * and states plainly whether it is an official Nazar entity (our project tag AND created by the
 * Nazar publisher wallet). This is what lets an assistant show that an answer can be checked
 * without trusting Nazar's API.
 */

export type ProofClient = Pick<PublicArkivClient, 'getEntity' | 'getBlockTiming'>

export interface ArkivProof {
  entityKey: string
  found: boolean
  /** Why the proof could not be completed (no live entity, RPC trouble), when it could not. */
  problem: string | null
  readAtBlock: string | null
  nazarProject: boolean
  /** Created by the Nazar publisher wallet; null when this server does not know the publisher. */
  officialPublisher: boolean | null
  publisher: string | null
  entity: Omit<DirectoryEntity, 'official'> | null
  explorer: { entity: string; creator: string | null }
  verdict: string
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Arkiv read timed out after ${ms} ms`)), ms).unref?.())])

const notFound = (err: unknown) => err instanceof NoEntityFoundError || (err as { name?: string } | null)?.name === 'NoEntityFoundError'

export async function readProof(
  entityKey: string,
  o: { client: ProofClient; publisher: Hex | null; explorerBase: string; now?: () => number; timeoutMs?: number },
): Promise<ArkivProof> {
  const ms = o.timeoutMs ?? 12_000
  const base = {
    entityKey,
    publisher: o.publisher,
    explorer: { entity: `${o.explorerBase}/entity/${entityKey}`, creator: null as string | null },
  }
  let raw
  try {
    raw = await withTimeout(o.client.getEntity(entityKey as Hex), ms)
  } catch (err) {
    if (!notFound(err)) throw err
    return {
      ...base,
      found: false,
      problem: 'no live entity with this key on Arkiv: it never existed, or it has expired',
      readAtBlock: null,
      nazarProject: false,
      officialPublisher: null,
      entity: null,
      verdict: 'NOT FOUND: Arkiv has no live entity with this key. It cannot be used as proof.',
    }
  }
  const { currentBlock } = await withTimeout(o.client.getBlockTiming(), ms)
  const now = (o.now ?? Date.now)()
  const { official, ...entity } = toDirectoryEntity(raw as never, o.publisher ?? '0x0000000000000000000000000000000000000000', currentBlock, now)
  const nazarProject = entity.attributes.some((a) => a.name === 'project' && a.value === PROJECT)
  const officialPublisher = o.publisher ? official : null
  const verdict =
    nazarProject && officialPublisher
      ? `OFFICIAL: a live Nazar ${entity.type || 'entity'} created by the Nazar publisher wallet ${o.publisher}, read directly from Arkiv at block ${currentBlock}.`
      : !nazarProject
        ? 'NOT NAZAR: this entity does not carry the Nazar project tag. Do not treat it as a Nazar alert.'
        : officialPublisher === false
          ? `NOT OFFICIAL: it copies the Nazar project tag but was created by ${entity.creator ?? 'an unknown wallet'}, not the Nazar publisher. Ignore it.`
          : `UNVERIFIED CREATOR: a Nazar-tagged entity created by ${entity.creator ?? 'an unknown wallet'}; this server does not know the publisher address to compare against.`
  return {
    ...base,
    explorer: { ...base.explorer, creator: entity.creator ? `${o.explorerBase}/address/${entity.creator}` : null },
    found: true,
    problem: null,
    readAtBlock: currentBlock.toString(),
    nazarProject,
    officialPublisher,
    entity,
    verdict,
  }
}
