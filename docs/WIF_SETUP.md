# Workload Identity Federation setup

This guide replaces the long-lived `FIREBASE_SERVICE_ACCOUNT` JSON key with short-lived credentials that GitHub Actions gets through Workload Identity Federation (WIF).
It also gives deploys their own identity instead of the shared Admin SDK one (finding OPS-5); the scheduled Pro alerts get their own runtime identity from `infra/alerts-identity.sh` (BE-11, [Pro alerts](DEPLOYMENT.md#pro-alerts)).
The owner runs every command here; repository agents never change Google Cloud or GitHub settings.

## How the workflows choose credentials

The deploy jobs in `.github/workflows/deploy.yml` call `.github/actions/firebase-cli`, which picks one of two paths:

- When the repository variable `GCP_WORKLOAD_IDENTITY_PROVIDER` is set, they authenticate through WIF as `GCP_DEPLOY_SERVICE_ACCOUNT`.
- Otherwise they fall back to the `FIREBASE_SERVICE_ACCOUNT` key secret and log a warning.

So merging the workflows changes nothing until the variables exist, and unsetting `GCP_WORKLOAD_IDENTITY_PROVIDER` is a one-step rollback while the key still exists.

## Before you start

You need `gcloud` signed in as a project owner, and `gh` signed in as the repository owner.
Run everything in one shell so the variables below stay set.

```bash
PROJECT_ID=uv-activity-planner
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
REPO=n8watkins/solara
# Numeric ids survive renames, unlike names. Check them with:
#   gh api repos/n8watkins/solara --jq '.id, .owner.id'
REPO_ID=1251693176
OWNER_ID=8055935
POOL=github
PROVIDER=solara
DEPLOY_SA="solara-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
```

Until WIF is live, deploys use the existing key.
Its identity was granted `roles/datastore.indexAdmin` on 2026-10-23 (D3), so the "Firestore indexes" job is green; the deploy identity created below gets the same role.

## 1. Enable the APIs

```bash
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  --project "$PROJECT_ID"
```

## 2. Create the identity pool and the GitHub provider

The attribute condition admits only tokens from this repository's `main` branch, so pull requests and other branches can never obtain Google credentials.
The `workflow` attribute holds the workflow file name (`deploy.yml`), which step 4 uses so only that workflow can use the deploy identity.

```bash
gcloud iam workload-identity-pools create "$POOL" \
  --project "$PROJECT_ID" --location global \
  --display-name "GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --project "$PROJECT_ID" --location global \
  --workload-identity-pool "$POOL" \
  --display-name "$REPO" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref,attribute.workflow=assertion.job_workflow_ref.extract('/.github/workflows/{workflow}@')" \
  --attribute-condition "assertion.repository_owner_id == '${OWNER_ID}' && assertion.repository_id == '${REPO_ID}' && assertion.ref == 'refs/heads/main'"
```

## 3. Create the two service accounts and grant their roles

The deploy identity can publish Hosting, rules and indexes, and nothing else until Functions are enabled:

```bash
gcloud iam service-accounts create solara-deploy \
  --project "$PROJECT_ID" --display-name "Solara deploy (GitHub Actions)"

for role in \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/firebase.viewer \
  roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${DEPLOY_SA}" --role "$role" --condition None
done
```

### Extra roles when Functions are enabled

Skip this until the project is on Blaze and `ENABLE_BLAZE_FUNCTIONS` is about to be set to `true`.
Functions have never been deployed from CI, so treat this list as the starting point and adjust it if the first Functions deploy reports a missing permission.

```bash
for role in \
  roles/cloudfunctions.admin \
  roles/cloudscheduler.admin \
  roles/secretmanager.admin \
  roles/artifactregistry.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${DEPLOY_SA}" --role "$role" --condition None
done

# Let the deploy identity attach the Functions runtime identity, and nothing broader.
# infra/alerts-identity.sh grants the same for the alerts' own identity (BE-11).
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/iam.serviceAccountUser
```

## 4. Let only the deploy workflow impersonate the deploy identity

```bash
PRINCIPALS="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --project "$PROJECT_ID" --role roles/iam.workloadIdentityUser \
  --member "${PRINCIPALS}/attribute.workflow/deploy.yml"
```

## 5. Point the workflows at WIF

```bash
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER -R "$REPO" \
  --body "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT -R "$REPO" --body "$DEPLOY_SA"
```

Then run the Deploy workflow from the Actions tab (Run workflow on `main`).
Each deploy job should log "Authenticating with Workload Identity Federation as solara-deploy@...".

## 6. Retire the key (D4)

Once deploys run on WIF, delete the key so nothing long-lived remains:

```bash
gcloud iam service-accounts keys list \
  --iam-account "firebase-adminsdk-fbsvc@${PROJECT_ID}.iam.gserviceaccount.com" \
  --managed-by user
# Delete each user-managed key listed above:
gcloud iam service-accounts keys delete KEY_ID \
  --iam-account "firebase-adminsdk-fbsvc@${PROJECT_ID}.iam.gserviceaccount.com"
gh secret delete FIREBASE_SERVICE_ACCOUNT -R "$REPO"
```

The Admin SDK service account itself stays: Firebase uses it internally.
If a deploy now fails with "No Google Cloud credentials", a WIF variable is missing.

## Rollback

While the key still exists, `gh variable delete GCP_WORKLOAD_IDENTITY_PROVIDER -R "$REPO"` returns deploys to the key.
After the key is deleted, fix the WIF configuration instead; creating a new key should be a last resort.

## Move public build values from secrets to variables

`NEXT_PUBLIC_*` values are compiled into the public bundle, so they are not secrets, and storing them as secrets masks them in logs and hides mistakes (OPS-20).
The build reads each one from a repository variable first and falls back to the secret of the same name, so you can move them one at a time.
For each `NEXT_PUBLIC_*` secret, create a variable with the same name and value, then delete the secret.
`NEXT_PUBLIC_SITE_URL` already has a variable, so only its secret is left to delete.

```bash
gh variable set NEXT_PUBLIC_FIREBASE_API_KEY -R "$REPO" --body "<value>"
gh secret delete NEXT_PUBLIC_FIREBASE_API_KEY -R "$REPO"
```

The Firebase web values are shown by `firebase apps:sdkconfig web --project "$PROJECT_ID"`.
The same applies to `STRIPE_PRICE_ID`, which the Functions deploy reads from a variable first.
`.github/scripts/check-public-env.mjs` fails the build if a required value is missing, points at another project, is not https where a URL is expected, or looks like a real secret.
