import * as net from "node:net";

const ID_MAX_BYTES = 255;

enum ErrorType {
  Empty = 'ID or required part of it is empty',
  InvalidCharacters = 'ID contains invalid characters',
  InvalidMatrixId = 'invalid matrix ID',
  InvalidMatrixToUri = 'invalid matrix.to URI',
  InvalidMatrixUri = 'invalid matrix URI',
  InvalidMxcUri = 'invalid Matrix Content URI',
  InvalidDomain = 'domain is not a valid IP address or domain name',
  MaximumLengthExceeded = 'ID exceeds 255 bytes',
  MissingColon = 'required colon is missing',
  MissingLeadingSigil = 'leading sigil is incorrect or missing',
}

type ErrorPayload<T extends ErrorType> =
  T extends ErrorType.InvalidMatrixId ? {} :
  T extends ErrorType.InvalidMatrixToUri ? {} :
  T extends ErrorType.InvalidMatrixUri ? {} :
  T extends ErrorType.InvalidMxcUri ? {} :
  never;

export class MatrixEntityError<
  T extends ErrorType = ErrorType
> extends Error {
  constructor(public errorType: T) {
    super(errorType);
  }
}

const isValidPort = (s: string) => {
  if (!s?.trim()) return false;

  const p = parseInt(s, 10);

  return !isNaN(p) && 0 <= p && p <= 65535 && String(p) === s.trim();
}

const validateDomain = (domain: string) => {
  if (!domain || domain.trim().length === 0)
    throw new MatrixEntityError(ErrorType.Empty);

  let endOfHost = domain.indexOf(':');
  if (endOfHost === -1)
    endOfHost = domain.length;

  if (domain.startsWith('[')) {
    const endOfIpv6 = domain.indexOf(']');

    if (endOfIpv6 === -1)
      throw new MatrixEntityError(ErrorType.InvalidDomain);

    const ipv6 = domain.substring(1, endOfIpv6);

    if (!ipv6 || ipv6.trim().length === 0 || !net.isIPv6(ipv6))
      throw new MatrixEntityError(ErrorType.InvalidDomain);

    const hasPort = domain.length > endOfIpv6 + 1;
    const validPort = hasPort &&
      domain[endOfIpv6 + 1] === ':' && isValidPort(domain.slice(endOfIpv6 + 2));

    if (hasPort && !validPort)
      throw new MatrixEntityError(ErrorType.InvalidDomain);
  }

  if (!/^[a-zA-Z0-9.-]+$/.test(domain.slice(0, endOfHost)))
    throw new MatrixEntityError(ErrorType.InvalidDomain);

  const hasPort = domain.length > endOfHost;
  const validPort = hasPort &&
    domain[endOfHost] === ':' && isValidPort(domain.slice(endOfHost + 1));

  if (hasPort && !validPort)
    throw new MatrixEntityError(ErrorType.InvalidDomain);
};


export class MatrixEntity {
  protected localpart: string;
  protected domain: string;

  constructor(private fullId: string, private sigil: string) {
    if (!fullId || fullId.trim().length === 0)
      throw new MatrixEntityError(ErrorType.Empty);

    if (fullId.length > ID_MAX_BYTES)
      throw new MatrixEntityError(ErrorType.MaximumLengthExceeded);

    if (!fullId.startsWith(sigil))
      throw new MatrixEntityError(ErrorType.MissingLeadingSigil);

    const colon = fullId.indexOf(':');
    if (colon === -1)
      throw new MatrixEntityError(ErrorType.MissingColon);

    const localpart = fullId.slice(1, colon);
    const domain = fullId.slice(colon + 1);

    if (!domain || domain.trim().length === 0)
      throw new MatrixEntityError(ErrorType.InvalidDomain);

    // Validate characters (per spec)
    if (!/^[a-z0-9._=-]+$/i.test(localpart))
      throw new MatrixEntityError(ErrorType.InvalidCharacters);

    validateDomain(domain);

    this.localpart = localpart;
    this.domain = domain;
  }

  public toString(): string {
    return this.fullId;
  }

  public getLocalpart(): string {
    return this.localpart;
  }

  public getDomain(): string {
    return this.domain;
  }
}

/**
 * Represents a Matrix user ID
 * @category Utilities
 */
export class UserId extends MatrixEntity {
  constructor(userId: string) {
    super(userId, '@')
  }
}

/**
 * Represents a Matrix room ID
 * @category Utilities
 */
export class RoomId extends MatrixEntity {
  constructor(id: string) {
    super(id, '!')

    if (id.includes('\0'))
      throw new MatrixEntityError(ErrorType.InvalidCharacters);
  }
}

/**
 * Represents a Matrix room alias
 * @category Utilities
 */
export class RoomAliasId extends MatrixEntity {
  constructor(alias: string) {
    super(alias, '#')
  }
}