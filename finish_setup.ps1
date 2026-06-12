param(
    [string]$PgPassword = ""
)

$PG_BIN  = "C:\Program Files\PostgreSQL\17\bin"
$PG_USER = "postgres"
$PG_HOST = "localhost"
$PG_PORT = "5432"
$DB_NAME = "nxt_people"
$psql    = "$PG_BIN\psql.exe"
$backendDir = Join-Path $PSScriptRoot "backend"

if ($PgPassword -eq "") {
    $secure = Read-Host "Enter PostgreSQL 'postgres' password" -AsSecureString
    $PgPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    )
}
$env:PGPASSWORD = $PgPassword

Write-Host ""
Write-Host "Step 1: Applying 2 missing columns (weekend_rules + holidays)..." -ForegroundColor Cyan

$fixSql = @"
ALTER TABLE weekend_rules ADD COLUMN IF NOT EXISTS is_compensatory BOOLEAN DEFAULT FALSE;
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS compensated_rule_id UUID REFERENCES weekend_rules(id) ON DELETE SET NULL;
"@

$fixSql | & $psql -U $PG_USER -h $PG_HOST -p $PG_PORT -d $DB_NAME
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED applying missing columns." -ForegroundColor Red
    exit 1
}
Write-Host "Missing columns applied!" -ForegroundColor Green

Write-Host ""
Write-Host "Step 2: Running index migration..." -ForegroundColor Cyan
Set-Location $backendDir
node migrate_indexes.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: migrate_indexes.js failed." -ForegroundColor Red
    exit 1
}
Write-Host "Indexes created!" -ForegroundColor Green

Write-Host ""
Write-Host "Step 3: Seeding default data..." -ForegroundColor Cyan
& $psql -U $PG_USER -h $PG_HOST -p $PG_PORT -d $DB_NAME -f "seed.sql"
Write-Host "Seed data inserted!" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  DATABASE SETUP COMPLETE!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Default credentials (password: password123):"
Write-Host "  Admin    : admin@nxtpeople.com"
Write-Host "  Manager  : sarah@nxtpeople.com"
Write-Host "  Employee : michael@nxtpeople.com"
Write-Host ""
Write-Host "  Start the backend:" -ForegroundColor Cyan
Write-Host "  cd backend && npm run dev" -ForegroundColor White
Write-Host ""
