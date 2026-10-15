param(
  [Parameter(Mandatory=$true)]
  [string]$TestFile,

  [Parameter(Mandatory=$true)]
  [string]$TestId
)

docker compose --profile tools run --rm k6 run `
  -o experimental-prometheus-rw `
  --tag "testid=$TestId" `
  "/scripts/$TestFile"
