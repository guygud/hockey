# Прототипы игр

Коллекция простых web-игр на примитивах. Деплой на GitHub Pages без сборки.

## Игры

| Игра | Путь |
|------|------|
| Удар с вертушки | [`/spinner/`](spinner/) |

## Локально

```bash
python3 -m http.server 8080
```

- Разводящая: [http://localhost:8080](http://localhost:8080)
- Хоккей: [http://localhost:8080/spinner/](http://localhost:8080/spinner/)

## GitHub Pages

Settings → Pages → branch `main` / root:

- [https://guygud.github.io/hockey/](https://guygud.github.io/hockey/) — разводящая
- [https://guygud.github.io/hockey/spinner/](https://guygud.github.io/hockey/spinner/) — хоккей

## Структура

```
index.html      — разводящая страница
hub.css         — стили разводящей
spinner/        — игра «Удар с вертушки»
  index.html
  game.js
  style.css
```
