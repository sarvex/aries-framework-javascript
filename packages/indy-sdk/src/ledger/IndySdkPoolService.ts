import type { AcceptanceMechanisms, AuthorAgreement, IndySdkPoolConfig } from './IndySdkPool'
import type { AgentContext } from '@aries-framework/core'
import type { GetNymResponse, LedgerReadReplyResponse, LedgerRequest, LedgerWriteReplyResponse } from 'indy-sdk'

import { CacheModuleConfig, InjectionSymbols, Logger, injectable, inject, FileSystem } from '@aries-framework/core'
import { Subject } from 'rxjs'

import { IndySdkError, isIndyError } from '../error'
import { IndySdk } from '../types'
import { assertIndySdkWallet } from '../utils/assertIndySdkWallet'
import { isSelfCertifiedDid } from '../utils/did'
import { allSettled, onlyFulfilled, onlyRejected } from '../utils/promises'

import { IndySdkPool } from './IndySdkPool'
import { IndySdkPoolError, IndySdkPoolNotConfiguredError, IndySdkPoolNotFoundError } from './error'

export interface CachedDidResponse {
  nymResponse: GetNymResponse
  poolId: string
}

@injectable()
export class IndySdkPoolService {
  public pools: IndySdkPool[] = []
  private logger: Logger
  private indySdk: IndySdk
  private stop$: Subject<boolean>
  private fileSystem: FileSystem

  public constructor(
    indySdk: IndySdk,
    @inject(InjectionSymbols.Logger) logger: Logger,
    @inject(InjectionSymbols.Stop$) stop$: Subject<boolean>,
    @inject(InjectionSymbols.FileSystem) fileSystem: FileSystem
  ) {
    this.logger = logger
    this.indySdk = indySdk
    this.fileSystem = fileSystem
    this.stop$ = stop$
  }

  public setPools(poolConfigs: IndySdkPoolConfig[]) {
    this.pools = poolConfigs.map(
      (poolConfig) => new IndySdkPool(poolConfig, this.indySdk, this.logger, this.stop$, this.fileSystem)
    )
  }

  /**
   * Create connections to all ledger pools
   */
  public async connectToPools() {
    const handleArray: number[] = []
    // Sequentially connect to pools so we don't use up too many resources connecting in parallel
    for (const pool of this.pools) {
      this.logger.debug(`Connecting to pool: ${pool.id}`)
      const poolHandle = await pool.connect()
      this.logger.debug(`Finished connection to pool: ${pool.id}`)
      handleArray.push(poolHandle)
    }
    return handleArray
  }

  /**
   * Get the most appropriate pool for the given did. The algorithm is based on the approach as described in this document:
   * https://docs.google.com/document/d/109C_eMsuZnTnYe2OAd02jAts1vC4axwEKIq7_4dnNVA/edit
   */
  public async getPoolForDid(
    agentContext: AgentContext,
    did: string
  ): Promise<{ pool: IndySdkPool; did: GetNymResponse }> {
    const pools = this.pools

    if (pools.length === 0) {
      throw new IndySdkPoolNotConfiguredError(
        "No indy ledgers configured. Provide at least one pool configuration in the 'indyLedgers' agent configuration"
      )
    }

    const cache = agentContext.dependencyManager.resolve(CacheModuleConfig).cache
    const cachedNymResponse = await cache.get<CachedDidResponse>(agentContext, `IndySdkPoolService:${did}`)
    const pool = this.pools.find((pool) => pool.id === cachedNymResponse?.poolId)

    // If we have the nym response with associated pool in the cache, we'll use that
    if (cachedNymResponse && pool) {
      this.logger.trace(`Found ledger id '${pool.id}' for did '${did}' in cache`)
      return { did: cachedNymResponse.nymResponse, pool }
    }

    const { successful, rejected } = await this.getSettledDidResponsesFromPools(did, pools)

    if (successful.length === 0) {
      const allNotFound = rejected.every((e) => e.reason instanceof IndySdkPoolNotFoundError)
      const rejectedOtherThanNotFound = rejected.filter((e) => !(e.reason instanceof IndySdkPoolNotFoundError))

      // All ledgers returned response that the did was not found
      if (allNotFound) {
        throw new IndySdkPoolNotFoundError(`Did '${did}' not found on any of the ledgers (total ${this.pools.length}).`)
      }

      // one or more of the ledgers returned an unknown error
      throw new IndySdkPoolError(
        `Unknown error retrieving did '${did}' from '${rejectedOtherThanNotFound.length}' of '${pools.length}' ledgers`,
        { cause: rejectedOtherThanNotFound[0].reason }
      )
    }

    // If there are self certified DIDs we always prefer it over non self certified DIDs
    // We take the first self certifying DID as we take the order in the
    // indyLedgers config as the order of preference of ledgers
    let value = successful.find((response) =>
      isSelfCertifiedDid(response.value.did.did, response.value.did.verkey)
    )?.value

    if (!value) {
      // Split between production and nonProduction ledgers. If there is at least one
      // successful response from a production ledger, only keep production ledgers
      // otherwise we only keep the non production ledgers.
      const production = successful.filter((s) => s.value.pool.config.isProduction)
      const nonProduction = successful.filter((s) => !s.value.pool.config.isProduction)
      const productionOrNonProduction = production.length >= 1 ? production : nonProduction

      // We take the first value as we take the order in the indyLedgers config as
      // the order of preference of ledgers
      value = productionOrNonProduction[0].value
    }

    await cache.set(agentContext, `IndySdkPoolService:${did}`, {
      nymResponse: value.did,
      poolId: value.pool.id,
    })
    return { pool: value.pool, did: value.did }
  }

  private async getSettledDidResponsesFromPools(did: string, pools: IndySdkPool[]) {
    this.logger.trace(`Retrieving did '${did}' from ${pools.length} ledgers`)
    const didResponses = await allSettled(pools.map((pool) => this.getDidFromPool(did, pool)))

    const successful = onlyFulfilled(didResponses)
    this.logger.trace(`Retrieved ${successful.length} responses from ledgers for did '${did}'`)

    const rejected = onlyRejected(didResponses)

    return {
      rejected,
      successful,
    }
  }

  /**
   * Get the most appropriate pool for the given indyNamespace
   */
  public getPoolForNamespace(indyNamespace?: string) {
    if (this.pools.length === 0) {
      throw new IndySdkPoolNotConfiguredError(
        "No indy ledgers configured. Provide at least one pool configuration in the 'indyLedgers' agent configuration"
      )
    }

    if (!indyNamespace) {
      this.logger.warn('Not passing the indyNamespace is deprecated and will be removed in the future version.')
      return this.pools[0]
    }

    const pool = this.pools.find((pool) => pool.didIndyNamespace === indyNamespace)

    if (!pool) {
      throw new IndySdkPoolNotFoundError(`No ledgers found for IndyNamespace '${indyNamespace}'.`)
    }

    return pool
  }

  public async submitWriteRequest(
    agentContext: AgentContext,
    pool: IndySdkPool,
    request: LedgerRequest,
    signDid: string
  ): Promise<LedgerWriteReplyResponse> {
    try {
      const requestWithTaa = await this.appendTaa(pool, request)
      const signedRequestWithTaa = await this.signRequest(agentContext, signDid, requestWithTaa)

      const response = await pool.submitWriteRequest(signedRequestWithTaa)

      return response
    } catch (error) {
      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  public async submitReadRequest(pool: IndySdkPool, request: LedgerRequest): Promise<LedgerReadReplyResponse> {
    try {
      const response = await pool.submitReadRequest(request)

      return response
    } catch (error) {
      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  private async signRequest(agentContext: AgentContext, did: string, request: LedgerRequest): Promise<LedgerRequest> {
    assertIndySdkWallet(agentContext.wallet)

    try {
      return this.indySdk.signRequest(agentContext.wallet.handle, did, request)
    } catch (error) {
      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  private async appendTaa(pool: IndySdkPool, request: LedgerRequest) {
    try {
      const authorAgreement = await this.getTransactionAuthorAgreement(pool)
      const taa = pool.config.transactionAuthorAgreement

      // If ledger does not have TAA, we can just send request
      if (authorAgreement == null) {
        return request
      }
      // Ledger has taa but user has not specified which one to use
      if (!taa) {
        throw new IndySdkPoolError(
          `Please, specify a transaction author agreement with version and acceptance mechanism. ${JSON.stringify(
            authorAgreement
          )}`
        )
      }

      // Throw an error if the pool doesn't have the specified version and acceptance mechanism
      if (
        authorAgreement.version !== taa.version ||
        !(taa.acceptanceMechanism in authorAgreement.acceptanceMechanisms.aml)
      ) {
        // Throw an error with a helpful message
        const errMessage = `Unable to satisfy matching TAA with mechanism ${JSON.stringify(
          taa.acceptanceMechanism
        )} and version ${JSON.stringify(taa.version)} in pool.\n Found ${JSON.stringify(
          Object.keys(authorAgreement.acceptanceMechanisms.aml)
        )} and version ${authorAgreement.version} in pool.`
        throw new IndySdkPoolError(errMessage)
      }

      const requestWithTaa = await this.indySdk.appendTxnAuthorAgreementAcceptanceToRequest(
        request,
        authorAgreement.text,
        taa.version,
        authorAgreement.digest,
        taa.acceptanceMechanism,
        // Current time since epoch
        // We can't use ratification_ts, as it must be greater than 1499906902
        Math.floor(new Date().getTime() / 1000)
      )

      return requestWithTaa
    } catch (error) {
      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  private async getTransactionAuthorAgreement(pool: IndySdkPool): Promise<AuthorAgreement | null> {
    try {
      // TODO Replace this condition with memoization
      if (pool.authorAgreement !== undefined) {
        return pool.authorAgreement
      }

      const taaRequest = await this.indySdk.buildGetTxnAuthorAgreementRequest(null)
      const taaResponse = await this.submitReadRequest(pool, taaRequest)
      const acceptanceMechanismRequest = await this.indySdk.buildGetAcceptanceMechanismsRequest(null)
      const acceptanceMechanismResponse = await this.submitReadRequest(pool, acceptanceMechanismRequest)

      // TAA can be null
      if (taaResponse.result.data == null) {
        pool.authorAgreement = null
        return null
      }

      // If TAA is not null, we can be sure AcceptanceMechanisms is also not null
      const authorAgreement = taaResponse.result.data as AuthorAgreement
      const acceptanceMechanisms = acceptanceMechanismResponse.result.data as AcceptanceMechanisms
      pool.authorAgreement = {
        ...authorAgreement,
        acceptanceMechanisms,
      }
      return pool.authorAgreement
    } catch (error) {
      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  private async getDidFromPool(did: string, pool: IndySdkPool): Promise<PublicDidRequest> {
    try {
      this.logger.trace(`Get public did '${did}' from ledger '${pool.id}'`)
      const request = await this.indySdk.buildGetNymRequest(null, did)

      this.logger.trace(`Submitting get did request for did '${did}' to ledger '${pool.id}'`)
      const response = await pool.submitReadRequest(request)

      const result = await this.indySdk.parseGetNymResponse(response)
      this.logger.trace(`Retrieved did '${did}' from ledger '${pool.id}'`, result)

      return {
        did: result,
        pool,
        response,
      }
    } catch (error) {
      this.logger.trace(`Error retrieving did '${did}' from ledger '${pool.id}'`, {
        error,
        did,
      })
      if (isIndyError(error, 'LedgerNotFound')) {
        throw new IndySdkPoolNotFoundError(`Did '${did}' not found on ledger ${pool.id}`)
      } else {
        throw isIndyError(error) ? new IndySdkError(error) : error
      }
    }
  }
}

export interface PublicDidRequest {
  did: GetNymResponse
  pool: IndySdkPool
  response: LedgerReadReplyResponse
}
