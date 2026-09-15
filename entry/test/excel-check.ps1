# excel-check.ps1 - open the files written by run.js in real Excel and compare cell values.
#
#   node entry/test/run.js
#   powershell -ExecutionPolicy Bypass -File entry/test/excel-check.ps1
#
# Why: run.js proves that nothing but the written cells changed, but only Excel can say
# whether it opens the file without the "We found a problem with some content" repair.
# Needs Excel on this PC. Exit code = number of NG.
#
# Tried with deliberately broken files on 2026-09-15: broken XML, overlapping merged cells,
# cells out of order in a row, the same cell twice -> Excel refused all four -> NG.
# With DisplayAlerts off it does not repair silently (and writes no repair log), so OK means
# "opened without repair". run.js also checks the order of rows/cells, for PCs without Excel.
#
# TRAP: when making a broken file, check that the replacement really happened. The first try
# targeted a cell that did not exist, nothing was broken, and it wrongly looked like Excel accepted it.
#
# NOTE: keep this file ASCII only. Windows PowerShell 5.1 reads a .ps1 without BOM as CP932,
# so Japanese text here would break. Japanese values are read from expect.json (UTF-8) instead.
param([string]$Dir = (Join-Path $PSScriptRoot 'out'))

$expectPath = Join-Path $Dir 'expect.json'
if (-not (Test-Path $expectPath)) { Write-Output "expect.json not found. Run: node entry/test/run.js"; exit 1 }
$expect = Get-Content -Raw -Encoding UTF8 $expectPath | ConvertFrom-Json

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$ng = 0
try {
  foreach ($f in $expect) {
    $path = Join-Path $Dir $f.file
    $wb = $null
    try {
      # UpdateLinks=0, ReadOnly=true. Do not pass [Type]::Missing for the rest: Open then fails for every file.
      $wb = $xl.Workbooks.Open($path, 0, $true)
    } catch {
      Write-Output ("NG   {0}: Excel could not open it ({1})" -f $f.file, $_.Exception.Message); $ng++; continue
    }
    if ($wb.Name -ne $f.file) {
      Write-Output ("NG   {0}: opened as '{1}' (Excel repaired it?)" -f $f.file, $wb.Name); $ng++
    }
    $ws = $wb.Worksheets.Item($f.sheet)
    $bad = 0; $n = 0
    foreach ($p in $f.cells.PSObject.Properties) {
      $n++
      $actual = $ws.Range($p.Name).Value2
      if ($null -eq $actual) { $actual = '' }
      if ([string]$actual -ne [string]$p.Value) {
        Write-Output ("NG   {0} {1}: expected={2} actual={3}" -f $f.file, $p.Name, $p.Value, $actual); $bad++
      }
    }
    if ($bad -eq 0) { Write-Output ("OK   {0}: opened in Excel, {1} cells match" -f $f.file, $n) } else { $ng += $bad }
    $wb.Close($false)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wb)
  }
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
exit $ng
