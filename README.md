# Удар с вертушки

Простой прототип: хоккеист на вертушке, шайба и два защитников перед воротами. Цель — обойти защитников и забить.

## Управление

- **Мышь / тач:** зажми, оттяни вертушку в сторону, отпусти — удар по шайбе.
- Кнопка **«Снова»** — новый раунд.

## Локально

```bash
python3 -m http.server 8080
```

Открой [http://localhost:8080](http://localhost:8080).

## GitHub Pages

После пуша в `main`:

1. Репозиторий → **Settings** → **Pages**
2. **Deploy from branch** → `main` / `/ (root)`
3. Игра: [https://guygud.github.io/hockey/](https://guygud.github.io/hockey/)
