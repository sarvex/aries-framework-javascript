import type { MediatorPickupStrategy } from './MediatorPickupStrategy'

/**
 * RecipientModuleConfigOptions defines the interface for the options of the RecipientModuleConfig class.
 * This can contain optional parameters that have default values in the config class itself.
 */
export interface RecipientModuleConfigOptions {
  /**
   * Strategy to use for picking up messages from the mediator. If no strategy is provided, the agent will use the discover
   * features protocol to determine the best strategy.
   *
   *
   * - `MediatorPickupStrategy.PickUpV1` - explicitly pick up messages from the mediator according to [RFC 0212 Pickup Protocol](https://github.com/hyperledger/aries-rfcs/blob/main/features/0212-pickup/README.md)
   * - `MediatorPickupStrategy.PickUpV2` - pick up messages from the mediator according to [RFC 0685 Pickup V2 Protocol](https://github.com/hyperledger/aries-rfcs/tree/main/features/0685-pickup-v2/README.md).
   * - `MediatorPickupStrategy.Implicit` - Open a WebSocket with the mediator to implicitly receive messages. (currently used by Aries Cloud Agent Python)
   * - `MediatorPickupStrategy.None`     - Do not retrieve messages from the mediator.
   *
   * @default undefined
   */
  mediatorPickupStrategy?: MediatorPickupStrategy

  /**
   * Interval in milliseconds between picking up message from the mediator. This is only applicable when the pickup protocol v1
   * is used.
   *
   * @default 5000
   */
  mediatorPollingInterval?: number

  /**
   * Maximum number of messages to retrieve from the mediator in a single batch. This is only applicable when the pickup protocol v2
   * is used.
   *
   * @todo integrate with pickup protocol v1
   * @default 10
   */
  maximumMessagePickup?: number

  /**
   * Initial interval in milliseconds between reconnection attempts when losing connection with the mediator. This value is doubled after
   * each retry, resulting in an exponential backoff strategy.
   *
   * For instance, if maximumMediatorReconnectionIntervalMs is b, the agent will attempt to reconnect after b, 2*b, 4*b, 8*b, 16*b, ... ms.
   *
   * This is only applicable when pickup protocol v2 or implicit pickup is used.
   *
   * @default 100
   */
  baseMediatorReconnectionIntervalMs?: number

  /**
   * Maximum interval in milliseconds between reconnection attempts when losing connection with the mediator.
   *
   * For instance, if maximumMediatorReconnectionIntervalMs is set to 1000 and maximumMediatorReconnectionIntervalMs is set to 10000,
   * the agent will attempt to reconnect after 1000, 2000, 4000, 8000, 10000, ..., 10000 ms.
   *
   * This is only applicable when pickup protocol v2 or implicit pickup is used.
   * @default Number.POSITIVE_INFINITY
   */
  maximumMediatorReconnectionIntervalMs?: number

  /**
   * Invitation url for connection to a mediator. If provided, a connection to the mediator will be made, and the mediator will be set as default.
   * This is meant as the simplest form of connecting to a mediator, if more control is desired the api should be used.
   *
   * Supports both RFC 0434 Out Of Band v1 and RFC 0160 Connections v1 invitations.
   */
  mediatorInvitationUrl?: string
}

export class RecipientModuleConfig {
  private options: RecipientModuleConfigOptions

  public constructor(options?: RecipientModuleConfigOptions) {
    this.options = options ?? {}
  }

  /** See {@link RecipientModuleConfigOptions.mediatorPollingInterval} */
  public get mediatorPollingInterval() {
    return this.options.mediatorPollingInterval ?? 5000
  }

  /** See {@link RecipientModuleConfigOptions.mediatorPickupStrategy} */
  public get mediatorPickupStrategy() {
    return this.options.mediatorPickupStrategy
  }

  /** See {@link RecipientModuleConfigOptions.maximumMessagePickup} */
  public get maximumMessagePickup() {
    return this.options.maximumMessagePickup ?? 10
  }

  /** See {@link RecipientModuleConfigOptions.baseMediatorReconnectionIntervalMs} */
  public get baseMediatorReconnectionIntervalMs() {
    return this.options.baseMediatorReconnectionIntervalMs ?? 100
  }

  /** See {@link RecipientModuleConfigOptions.maximumMediatorReconnectionIntervalMs} */
  public get maximumMediatorReconnectionIntervalMs() {
    return this.options.maximumMediatorReconnectionIntervalMs ?? Number.POSITIVE_INFINITY
  }

  /** See {@link RecipientModuleConfigOptions.mediatorInvitationUrl} */
  public get mediatorInvitationUrl() {
    return this.options.mediatorInvitationUrl
  }
}
