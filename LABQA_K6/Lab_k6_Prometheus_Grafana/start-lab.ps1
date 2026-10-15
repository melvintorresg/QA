Write-Host "Iniciando aplicación, Prometheus y Grafana..."
docker compose up -d --build performance-app prometheus grafana
Write-Host ""
Write-Host "Aplicación: http://localhost:3000"
Write-Host "Prometheus: http://localhost:9090"
Write-Host "Grafana: http://localhost:3001"
Write-Host "Grafana user: admin / admin123"
