import type { RequestedAttribute, RequestedPredicate } from '../models'

/**
 * Sort requested attributes and predicates by `revoked` status. The order is:
 *  - first credentials with `revoked` set to undefined, this means no revocation status is needed for the credentials
 *  - then credentials with `revoked` set to false, this means the credentials are not revoked
 *  - then credentials with `revoked` set to true, this means the credentials are revoked
 */
export function sortRequestedCredentials<Requested extends Array<RequestedAttribute> | Array<RequestedPredicate>>(
  credentials: Requested
) {
  const staySame = 0
  const credentialGoUp = -1
  const credentialGoDown = 1

  // Clone as sort is in place
  const credentialsClone = [...credentials]

  return credentialsClone.sort((credential, compareTo) => {
    // Nothing needs to happen if values are the same
    if (credential.revoked === compareTo.revoked) return staySame

    // Undefined always is at the top
    if (credential.revoked === undefined) return credentialGoUp
    if (compareTo.revoked === undefined) return credentialGoDown

    // Then revoked
    if (credential.revoked === false) return credentialGoUp

    // It means that compareTo is false and credential is true
    return credentialGoDown
  })
}
