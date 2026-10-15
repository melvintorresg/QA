# Laboratorio: k6 + Prometheus + Grafana + Docker

## Objetivo

Ejecutar 10 pruebas de rendimiento sobre una aplicación compleja, enviar las métricas de k6 a Prometheus y analizarlas gráficamente en Grafana.

Arquitectura:

```text
k6
 │
 │ genera carga
 ▼
Aplicación Node.js
 │
 ├───────────────► /metrics ─────────► Prometheus
 │                                      ▲
 └──── k6 Prometheus Remote Write ──────┘
                                        │
                                        ▼
                                     Grafana
```

## Requisitos

- Windows 10/11
- Docker Desktop iniciado
- PowerShell
- 6 GB de RAM libres recomendados para Docker Desktop

No necesita instalar Node.js, Prometheus, Grafana ni k6 directamente en Windows.

---

## Paso 1. Iniciar el laboratorio

Abra PowerShell dentro de la carpeta y ejecute:

```powershell
.\start-lab.ps1
```

Si PowerShell bloquea scripts, puede ejecutar directamente:

```powershell
docker compose up -d --build performance-app prometheus grafana
```

Verifique:

```powershell
docker ps
```

Debe ver:

```text
performance-app
prometheus
grafana
```

---

## Paso 2. Abrir las herramientas

Aplicación:

```text
http://localhost:3000
```

Prometheus:

```text
http://localhost:9090
```

Grafana:

```text
http://localhost:3001
```

Credenciales de Grafana:

```text
Usuario: admin
Contraseña: admin123
```

El datasource Prometheus y el dashboard `k6 Performance Lab` ya están configurados automáticamente.

En Grafana:

```text
Dashboards
→ Performance Lab
→ k6 Performance Lab
```

---

## Paso 3. Validar Prometheus

Abra:

```text
http://localhost:9090
```

Pruebe estas consultas:

```promql
app_requests_total
```

```promql
app_inflight_requests
```

```promql
app_cache_hit_total
```

Si aparecen datos, Prometheus está leyendo la aplicación.

---

## Paso 4. Ejecutar una prueba k6

Use el helper:

```powershell
.\run-test.ps1 01-auth-correlation.js auth-01
```

Este comando ejecuta k6 dentro de Docker y envía métricas a Prometheus mediante Prometheus Remote Write.

También puede ejecutar el comando completo:

```powershell
docker compose --profile tools run --rm k6 run `
  -o experimental-prometheus-rw `
  --tag testid=auth-01 `
  /scripts/01-auth-correlation.js
```

Mientras corre la prueba, mantenga Grafana abierto.

---

# Las 10 pruebas

## 1. Autenticación y correlación

Archivo:

```text
01-auth-correlation.js
```

Ejecute:

```powershell
.\run-test.ps1 01-auth-correlation.js auth-01
```

Observe:

- login
- token
- p95 del login
- p95 de producto
- errores 401/403
- VUs
- RPS

Pregunta:

¿La autenticación se convierte en un cuello de botella?

---

## 2. Caché HIT/MISS

```powershell
.\reset-app.ps1
.\run-test.ps1 02-cache-hit-miss.js cache-01
```

Observe en Grafana:

- `app_cache_hit_total`
- `app_cache_miss_total`
- p95
- requests/s

Pregunta:

¿Cuánto mejora el sistema después de que el dato entra en caché?

---

## 3. Mixed Workload

```powershell
.\reset-app.ps1
.\run-test.ps1 03-mixed-workload.js mixed-01
```

Esta prueba mezcla:

- navegación
- búsquedas
- órdenes

y utiliza distintos modelos de carga.

Observe:

- VUs
- RPS
- p95
- errores
- in-flight requests

Pregunta:

¿Qué flujo se degrada primero?

---

## 4. Rate Limiting

```powershell
.\reset-app.ps1
.\run-test.ps1 04-rate-limiting.js rate-limit-01
```

Observe:

- HTTP 429
- `app_rate_limited_total`
- error rate
- RPS

Pregunta:

¿HTTP 429 representa un fallo o un mecanismo de protección?

---

## 5. Idempotencia

```powershell
.\reset-app.ps1
.\run-test.ps1 05-idempotency.js idem-01
```

La prueba envía una operación repetida con la misma `Idempotency-Key`.

Observe:

- órdenes creadas
- respuestas duplicadas
- checks

Pregunta:

¿Por qué una aplicación bancaria o de pagos necesita idempotencia?

---

## 6. Exportación asíncrona

```powershell
.\reset-app.ps1
.\run-test.ps1 06-async-export.js async-01
```

El flujo es:

```text
POST /exports
   ↓
202 + jobId
   ↓
polling
   ↓
completed
```

Observe:

- `export_e2e`
- p95
- número de requests
- duración del flujo completo

Pregunta:

¿Por qué no basta con medir únicamente el POST inicial?

---

## 7. Falla de dependencia

```powershell
.\reset-app.ps1
.\run-test.ps1 07-dependency-failure.js dependency-01
```

El proveedor de pagos falla ocasionalmente.

Observe:

- `payment_failures`
- `app_payments_failed_total`
- error rate
- p95

Pregunta:

¿Cómo distingue entre un problema de su aplicación y uno del proveedor externo?

---

## 8. Breaking Point

```powershell
.\reset-app.ps1
.\run-test.ps1 08-breaking-point.js stress-01
```

Mantenga Grafana visible durante toda la ejecución.

Observe cómo cambian:

```text
RPS
p95
error rate
in-flight requests
```

a medida que aumenta la tasa de llegada.

Pregunta:

¿En qué momento el sistema deja de cumplir el SLO aunque todavía responda?

---

## 9. Spike + recuperación

```powershell
.\reset-app.ps1
.\run-test.ps1 09-spike-recovery.js spike-01
```

La carga pasa aproximadamente de:

```text
5 VUs
  ↓
100 VUs
  ↓
5 VUs
```

Observe en Grafana si el p95 vuelve a su nivel original.

Pregunta:

¿Sobrevivir al pico significa que el sistema es resiliente?

---

## 10. Release Gate

```powershell
.\reset-app.ps1
.\run-test.ps1 10-release-gate.js release-01
```

Esta prueba combina:

- login
- producto
- búsqueda
- orden
- pago
- exportación

y evalúa varios thresholds.

Al finalizar revise:

```text
results/release-summary.json
```

Decisión final:

```text
GO
```

o:

```text
NO-GO
```

Debe justificarla con métricas.

---

# Qué deben observar en Grafana

En el dashboard encontrará:

- VUs
- requests por segundo
- p95
- error rate
- solicitudes concurrentes
- requests/s de la aplicación
- errores/s
- caché HIT/MISS
- rate limiting
- fallas de pagos
- órdenes creadas

Use el filtro **Test ID** para seleccionar una ejecución concreta.

Ejemplos:

```text
auth-01
cache-01
mixed-01
stress-01
spike-01
release-01
```

---

# Preguntas finales

1. ¿Qué prueba produjo el mayor p95?
2. ¿Cuál fue el breaking point aproximado?
3. ¿Qué ocurrió con los RPS cuando el sistema comenzó a saturarse?
4. ¿Cómo se comportó el error rate?
5. ¿Qué efecto tuvo el caché?
6. ¿Qué mostró el rate limiting?
7. ¿Cuál fue el porcentaje de fallas del proveedor de pagos?
8. ¿El sistema se recuperó después del spike?
9. ¿El Release Gate terminó en GO o NO-GO?
10. ¿Qué recomendaría mejorar antes de producción?

---

# Apagar el laboratorio

```powershell
.\stop-lab.ps1
```

o:

```powershell
docker compose down
```

Para borrar también los datos de Prometheus:

```powershell
docker compose down -v
```

## Opcional

Además del dashboard incluido, puede importar el dashboard oficial de k6 para Prometheus desde Grafana usando el ID:

```text
19665
```
