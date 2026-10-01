[CmdletBinding()]
param([ValidateSet('Docs', 'Ui', 'Core', 'Cross', 'PreMerge')][string]$Lane = 'PreMerge')
& node (Join-Path $PSScriptRoot 'verify-development.mjs') $Lane
exit $LASTEXITCODE
