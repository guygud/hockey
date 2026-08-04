# Прототипы игр

Коллекция простых web-игр на примитивах. Деплой на GitHub Pages без сборки.

## Игры

| Игра | Путь |
|------|------|
| Удар с вертушки | [`/spinner/`](spinner/) |
| Симулятор шайбы | [`/puck/`](puck/) |
| Свои и чужие | [`/dodge/`](dodge/) |
| Атака на бите | [`/rhythm/`](rhythm/) |
| Распасовка | [`/pass/`](pass/) |

## Локально

```bash
python3 -m http.server 8765
```

- Разводящая: [http://localhost:8765](http://localhost:8765)
- Вертушка: [http://localhost:8765/spinner/](http://localhost:8765/spinner/)
- Симулятор шайбы: [http://localhost:8765/puck/](http://localhost:8765/puck/)
- Свои и чужие: [http://localhost:8765/dodge/](http://localhost:8765/dodge/)
- Атака на бите: [http://localhost:8765/rhythm/](http://localhost:8765/rhythm/)
- Распасовка: [http://localhost:8765/pass/](http://localhost:8765/pass/)

## GitHub Pages

Settings → Pages → branch `main` / root:

- [https://guygud.github.io/hockey/](https://guygud.github.io/hockey/) — разводящая
- [https://guygud.github.io/hockey/spinner/](https://guygud.github.io/hockey/spinner/) — вертушка
- [https://guygud.github.io/hockey/puck/](https://guygud.github.io/hockey/puck/) — симулятор шайбы
- [https://guygud.github.io/hockey/dodge/](https://guygud.github.io/hockey/dodge/) — свои и чужие
- [https://guygud.github.io/hockey/rhythm/](https://guygud.github.io/hockey/rhythm/) — атака на бите
- [https://guygud.github.io/hockey/pass/](https://guygud.github.io/hockey/pass/) — распасовка

## Структура

```
index.html      — разводящая страница
hub.css         — стили разводящей
spinner/        — «Удар с вертушки»
puck/           — «Симулятор шайбы»
dodge/          — «Свои и чужие» (шайба с вражескими клюшками)
rhythm/         — «Атака на бите»
pass/           — «Распасовка»
```
