// Local public snapshot publisher convention, never proof of origin or chain time.
const publicationName = /^observation-(0|[1-9]\d{0,15})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
export function reportPublicationTime(name: string): bigint | undefined {
  const match = publicationName.exec(name);
  return match ? BigInt(match[1]) : undefined;
}
