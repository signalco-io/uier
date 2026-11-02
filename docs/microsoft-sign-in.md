# Microsoft sign-in

The sign-in card offers **Microsoft** ("Sign in with Microsoft" to assistive technologies) alongside
passkeys, Google and email, as the same outline button with the Microsoft logo in its own colours.
Work and school accounts and personal Microsoft accounts are supported. Email sign-in stays
available. Account → Sign-in → Microsoft account lets people link or unlink their Microsoft identity.

## Register the application

Use a separate Entra app registration from Azure Boards. Login requests only `openid email profile`;
it requests no Microsoft Graph or Azure DevOps access, refresh tokens or Boards permissions.
The existing Boards app supports organizational accounts, whereas login also accepts personal accounts.

1. In [Microsoft Entra app registrations](https://entra.microsoft.com/), create an application named
   `uier sign-in`. Choose **Accounts in any organizational directory and personal Microsoft accounts**.
2. Add a **Web** redirect URI: `https://uier.io/app/sign-in/microsoft/callback`. Leave implicit ID/access
   token grants and public client flows disabled. This is a server-side authorization code flow.
3. Set the home page to `https://uier.io`, privacy statement to
   `https://uier.io/legal/privacy-policy`, and terms to `https://uier.io/legal/terms-of-service`.
   Use the existing organization publisher details and verification process.
4. Create a client secret. Copy its **value**, plus the Application (client) ID. Track its expiry
   and rotate it before expiration. Login needs only the OIDC scopes; do not add Boards permissions.
5. Add `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` to the existing `UIER_INTEGRATION_ENV`
   repository secret, preserving its other entries. Follow
   [production credentials](integration-setup.md#production-credentials). CI provisions production-only
   Vercel variables through `infra/src/integrations.ts`. Never run `pulumi up` locally.
6. Review the CI infrastructure preview: only the two new Vercel variables are expected. Deploy
   through the normal main-branch pipeline, then test first email confirmation, returning Microsoft
   sign-in, Account linking/unlinking and cancellation with real work/school and personal accounts.

The button is hidden until both credentials are configured. It is always disabled on previews,
which lack a stable registered callback. Use a separate local app registration for development,
with `http://localhost:4004/app/sign-in/microsoft/callback` and credentials in `apps/web/.env.local`.
Never copy production secrets to local development or previews.

## Identity and linking

Microsoft documents `email` and `preferred_username` as mutable, potentially absent and unsuitable
for authorization. uier treats them as editable suggestions. Even an `outlook.com` address does
not find or create an account without proving its inbox.

- A linked identity signs in directly. The identity key is SHA-256 of the validated issuer, a
  newline and the token's `sub`. Two tenants with the same subject remain separate identities.
  Changed Microsoft addresses never change the uier account email, staff status or memberships.
- A new identity waits for up to 15 minutes while the person chooses an inbox and confirms its
  email code. They can choose an existing uier email to keep their projects. The usual sign-in
  request carries `microsoftLinkId` only from the explicit Microsoft confirmation form, using the
  pending identity's signed browser cookie. The code always requires its request binding; an
  emailed link in another browser signs in by email and links no Microsoft account.
- Account linking requires a sign-in from the last 10 minutes, checked at the start and at the
  callback against the flow's creation time. The callback must use the initiating user's session.
  It links to that user regardless of the suggested Microsoft email.
- Each uier user can link one Microsoft identity. An identity belonging to another user is refused.
  Unlinking removes the user-side record first; sign-in requires that it and the unique identity
  claim agree. A leftover claim cannot continue signing in after an interrupted unlink.

## Protocol and storage

`apps/web/src/lib/app/microsoft/` follows the existing Google flow: authorization code with S256
PKCE, random state and nonce, 30 starts per IP per hour, safe `/app` return paths, and no prefetched
or cross-site starts. The ten-minute flow record stores only state/nonce hashes and the return path,
plus the initiating user for Account linking. The verifier is derived with a purpose-specific
keyed hash and never stored. The callback atomically consumes the flow before exchanging its code.

`jose` checks RS256 signatures with cached, rotating tenant-scoped Microsoft JWKS, the key issuer,
the exact v2 issuer and tenant, client audience, token lifetime, issue time and nonce. Tenant IDs
must be GUIDs before selecting a fixed Microsoft-host key endpoint. No URL comes from token metadata.
Access, refresh and ID tokens and authorization codes are never persisted or logged. The callback
redirects with bounded outcome names and never copies OAuth codes or state to its destination.

| Document | Partition | Lifetime |
| --- | --- | --- |
| `microsoft-sign-in`: hashes, safe return path, optional linking user | `microsoft-sign-in:<id>` | 10 minutes |
| `microsoft-link`: hashed identity, suggested email, return path | `microsoft-link:<id>` | 15 minutes |
| `user-identity`: hashed identity → user | `identity:microsoft:<hash>` | Until unlinked |
| `microsoft-account`: hashed identity, suggested address, linked time | `user:<userId>`, id `microsoft` | Until unlinked |

The signed HttpOnly `__Host-uier_microsoft_sign_in` cookie binds both pending record types to the
browser with different token purposes. It uses Secure, SameSite=Lax and Path=/ outside local HTTP
development. The callback clears it; email confirmation and `startSession` clear it again.

## Local tests

`e2e/support/microsoftStub.ts` supplies authorization, token and tenant JWKS endpoints with real RSA
signatures. Playwright starts it on `PORT + 8000`. The three `MICROSOFT_OAUTH_*` overrides
(`AUTHORIZE_URL`, `TOKEN_URL`, `AUTHORITY`) accept loopback addresses only in local runtime and
are ignored on deployments. Infrastructure rejects these overrides.

After `pnpm build`, run:

```sh
PLAYWRIGHT_FULL=1 pnpm -C apps/web exec playwright test microsoft-sign-in.api.spec.ts microsoft-sign-in.spec.ts --project=API --project='Desktop Chrome' --project='Mobile Chrome' --retries=0
```

The API suite covers signatures and claims, tenant isolation, callback replay/expiry/binding,
mailbox proof, Account session freshness, conflicts, configuration and route guards. Browser tests
exercise first and returning sign-in, editable/missing addresses, unlinking, Account linking,
cancellation and accessibility. Local stand-ins do not prove a real Entra registration or live rollout.

References: [Microsoft OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc),
[ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference),
[sign-in branding and logo source](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-branding-in-apps).
