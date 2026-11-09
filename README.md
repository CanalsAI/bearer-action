# Bearer Action

This is CanalsAI's modified fork of [Bearer/bearer-action](https://github.com/Bearer/bearer-action).
It adds verified download caching while preserving the upstream scan inputs, outputs, and failure behavior.

## CanalsAI cache behavior

Use `CanalsAI/bearer-action` pinned to a reviewed commit SHA. The default `version: latest`
refreshes the authenticated GitHub release lookup once per UTC day and selects the highest
stable version whose release and binary asset were published at least eight days ago.
Replacing an asset on an older release starts a new quarantine for that asset.
New releases become eligible automatically
after that quarantine and select a new binary cache key without a workflow PR. Prereleases
and drafts are excluded. A failed refresh retains the
last validated cached release and emits a warning; without a valid release, setup fails.
An explicit stable version such as `version: '2.1.3'` is also supported and must meet the
same minimum age. The age gate is enforced again when reading cached release metadata.

Release metadata and scanner archives use separate Actions caches. Archives are checked
against GitHub's release SHA-256 digest on every use and extracted into the job's temporary
directory. Downloads check HTTP status, retry transient errors, and enter the cache only
after validation. The floating upstream installer script is no longer executed.

Rule archives retain Bearer's URL-based filenames and automatic rule updates. A daily
Actions cache with fallback to earlier snapshots restores these archives. Invalid archives
are removed before and after scanning so an upstream error response cannot poison the
next retry or be saved to cache. Bearer's rules metadata check still contacts its upstream
service; this fork does not disable default rules or change scan options. The scanner age
gate does not apply to Bearer's separately downloaded rules.
Valid rule archives are cached even when security findings fail a scan; the scan still fails.

Requirements: Linux or macOS on x64 or arm64, Bash, curl with `--retry-all-errors`, jq,
tar, and shasum. The GitHub release must provide a SHA-256 digest for its scanner archive.

## Upstream usage reference

Run [Bearer](https://docs.bearer.com/) as a [GitHub Action](https://github.com/features/actions).

## Example usage

### Using defaults

``` yaml
steps:
  - uses: actions/checkout@v3
  - uses: bearer/bearer-action@v2
```

### Using custom values for inputs

``` yaml
steps:
  - uses: actions/checkout@v3
  - name: Bearer
    uses: bearer/bearer-action@v2
    with:
      path: 'some-path-to-scan'
      config-file: '/some/path/bearer.yml'
      only-rule: 'ruby_lang_cookies,ruby_lang_http_post_insecure_with_data'
      skip-path: 'users/*.go,users/admin.sql'
```

### Full Reporting Example

```yaml
name: Bearer

on:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  rule_check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Report
        id: report
        uses: bearer/bearer-action@v2
```

you can see this workflow in action on our [demo repo](https://github.com/Bearer/bear-publishing/actions/workflows/bearer.yml)

### Pull Request Diff

When the Bearer action is being used to check a pull request, you can tell the
action to only report findings introduced within the pull request by setting
the `diff` input parameter to `true`.

```yaml
name: Bearer PR Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

jobs:
  rule_check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Report
        id: report
        uses: bearer/bearer-action@v2
        with:
          diff: true
```

See our guide on [configuring a scan](https://docs.bearer.com/guides/configure-scan#only-report-new-findings-on-a-branch)
for more information on differential scans.

### Using [Reviewdog](https://github.com/Reviewdog/Reviewdog) for PR review comments with Bearer

```yaml
name: Bearer PR Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  rule_check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: reviewdog/action-setup@v1
        with:
          reviewdog_version: latest
      - name: Run Report
        id: report
        uses: bearer/bearer-action@v2
        with:
          format: rdjson
          output: rd.json
          diff: true
      - name: Run reviewdog
        if: always()
        env:
          REVIEWDOG_GITHUB_API_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          cat rd.json | reviewdog -f=rdjson -reporter=github-pr-review
```

### Using [Defect Dojo](https://github.com/DefectDojo/django-DefectDojo) to monitor findings

```yaml
name: Bearer Defect Dojo

on:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  rule_check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Report
        id: report
        uses: bearer/bearer-action@v2
        with:
          format: gitlab-sast
          output: gl-sast-report.json
      - name: Defect Dojo
        if: always()
        env:
          DD_TOKEN: ${{ secrets.DD_TOKEN}}
          DD_APP: ${{ secrets.DD_APP}}
          DD_ENGAGEMENT: ${{ secrets.DD_ENGAGEMENT}}
        run: |
          curl -X POST -F "file=@gl-sast-report.json" -F "product_name=$DD_APP" -F "engagement_name=$DD_ENGAGEMENT" -F "scan_type=GitLab SAST Report" -H "Authorization: Token $DD_TOKEN" http://example.com/api/v2/import-scan/
```

## Inputs

### `version`

**Optional** Specify the Bearer version to use. This must match a Bearer release name.

### `scanner`

**Optional** Specify the comma-separated scanner to use e.g. `sast,secrets`

### `config-file`

**Optional** configuration file path

### `only-rule`

**Optional** Specify the comma-separated IDs of the rules to run; skips all other rules.

### `skip-rule`

**Optional** Specify the comma-separated IDs of the rules to skip; runs all other rules.

### `skip-path`

**Optional** Specify the comma-separated paths to skip. Supports wildcard syntax, e.g. `users/*.go,users/admin.sql`

### `exclude-fingerprint`

**Optional** Specify the comma-separated fingerprints of the findings you would like to exclude from the report.

### `severity`

**Optional** Specify which severities are included in the report as a comma separated string, e.g. `critical,medium`

### `format`

**Optional** Specify which format to use, e.g. `json`

### `output`

**Optional** Specify where to store the report, e.g. `results.sarif`

### `exit-code`

**Optional** Force the exit code when findings are detected. Set this to 0 (success), for example, for the action to always pass

## Outputs

### `rule_breaches`

Details of any rule breaches that occur. This is URL encoded to work round GitHub issues with multiline outputs.

### `exit_code`

Exit code of the binary, 0 indicates a pass
