# Переход на Groq

Остановите старый сервер. Распакуйте обновлённый архив в отдельную папку, перенесите туда свой `.env`, сохранив SERPER_API_KEY. Добавьте или замените:

```dotenv
AI_PROVIDER=groq
GROQ_API_KEY=ваш_ключ
GROQ_MODEL=qwen/qwen3.6-27b
AI_TIMEOUT_MS=25000
IMAGE_CONCURRENCY=2
MAX_IMAGES=10
JOB_BUDGET_MS=90000
```

В папке с package.json:

```sh
npm ci
npm run dev
```

Откройте http://localhost:5173. Первый тест: полное название университета. Groq выбран явно; сохранённый GEMINI_API_KEY не используется. Для возврата нужен AI_PROVIDER=gemini и действующий ключ Gemini. Автоматического переключения между провайдерами нет.

Groq получает текст и реальные JPEG-данные. Используется JSON mode и строгая локальная проверка Zod, а не обещание гарантированного соответствия JSON Schema со стороны модели. Serper, категории, теги, reasoning и frontend-контракты сохранены. Ключи в frontend не передаются.

При AI_RATE_LIMITED проверьте квоту выбранной модели в Groq Console: бесплатный доступ ограничен, параллелизм 2 не гарантирует соблюдение токенов в минуту. AI_ACCESS_DENIED означает отказ авторизации/доступа; AI_MODEL_UNAVAILABLE — HTTP 404; AI_TIMEOUT — тайм-аут; AI_INVALID_RESPONSE — некорректная или обрезанная структура ответа.

Документация: https://console.groq.com/docs/vision
Ключи: https://console.groq.com/keys
Лимиты: https://console.groq.com/docs/rate-limits

Сборка и автоматические тесты проверены на подставных ответах API. Живой запрос с вашим ключом здесь не выполнялся, скорость и доступность модели в вашем аккаунте ещё нужно проверить.
