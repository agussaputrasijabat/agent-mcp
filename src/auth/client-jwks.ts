const googleClientMetadataOrigin = "https://accountlinking.google.com";
const googleClientJwksUri = "https://www.gstatic.com/account-linking/.well-known/client-assertion-signature-verification-key.json";

export function isTrustedGoogleClientJwksUri(clientId: string, jwksUri: string): boolean {
  if (jwksUri !== googleClientJwksUri) return false;
  try {
    const metadata = new URL(clientId);
    return metadata.origin === googleClientMetadataOrigin &&
      !metadata.username && !metadata.password && !metadata.search && !metadata.hash &&
      /^\/clientidmetadata\/user_bound_provider\/[A-Za-z0-9_-]+$/.test(metadata.pathname);
  } catch {
    return false;
  }
}
