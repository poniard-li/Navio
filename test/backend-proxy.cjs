'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

test('proxy recovery guard preserves external enable, bypass and PAC changes without registry writes', { skip: process.platform !== 'win32' }, async () => {
  // Load only the pure comparison function from the PowerShell AST. The script
  // body and registry functions are never evaluated by this test.
  const command = `
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:DEX_PROXY_SCRIPT_PATH, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw 'PowerShell parse failure' }
$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-DexAppliedState' }, $true)
. ([scriptblock]::Create($function.Extent.Text))
$values = @{ ProxyEnable = @{ exists = $true; value = 1 }; ProxyServer = @{ exists = $true; value = '127.0.0.1:17890' }; ProxyOverride = @{ exists = $true; value = '<local>;localhost;127.*' }; AutoConfigURL = @{ exists = $false; value = $null } }
$original = Test-DexAppliedState -Values $values
$values.ProxyEnable.value = 0
$disabled = Test-DexAppliedState -Values $values
$values.ProxyEnable.value = 1
$values.ProxyOverride.value = '*.example.test'
$bypass = Test-DexAppliedState -Values $values
$values.ProxyOverride.value = '<local>;localhost;127.*'
$values.AutoConfigURL.exists = $true
$values.AutoConfigURL.value = 'https://example.test/proxy.pac'
$pac = Test-DexAppliedState -Values $values
@{ original = $original; disabled = $disabled; bypass = $bypass; pac = $pac } | ConvertTo-Json -Compress
`;
  const result = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10_000, env: { ...process.env, DEX_PROXY_SCRIPT_PATH: path.resolve(__dirname, '..', 'scripts', 'proxy-state.ps1') } });
  assert.deepEqual(JSON.parse(result.stdout), { original: true, disabled: false, bypass: false, pac: false });
});
