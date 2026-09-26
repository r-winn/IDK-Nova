# Windows code signing

IDK Nova's release workflow supports Authenticode signing without storing a
certificate or private key in this public repository.

## Why signing matters

Windows code signing proves who published an executable and detects changes
after signing. It is the supported way to reduce Microsoft Defender SmartScreen
warnings. A new certificate may still need time and consistent signed releases
to build reputation.

## Required GitHub Actions secrets

Add these encrypted repository secrets under **Settings → Secrets and variables
→ Actions**:

- `WINDOWS_CERTIFICATE`: Base64 representation of a valid code-signing `.pfx`
  certificate.
- `WINDOWS_CERTIFICATE_PASSWORD`: Password protecting that `.pfx` file.

On Windows, create the Base64 value with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('certificate.pfx')) | Set-Clipboard
```

The workflow imports the certificate into the temporary GitHub Windows runner,
discovers its thumbprint, signs with SHA-256, timestamps through DigiCert, and
then destroys the runner. The certificate file is never committed or uploaded
as a release asset.

When the secrets are absent, the workflow deliberately produces an unsigned
community build and labels the Release accordingly.

## Verification

After downloading a signed installer, open **Properties → Digital Signatures**
or run:

```powershell
Get-AuthenticodeSignature .\IDK.Nova_*_x64-setup.exe | Format-List
```

The status must be `Valid`, the signer must match the certificate owner, and
the timestamp must be present.

See the official [Tauri Windows code-signing guide](https://v2.tauri.app/distribute/sign/windows/).
