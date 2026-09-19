# API и три уровня JSON

Ключи JSON пишутся с обычным `_`: `is_relevant`, а не `is\_relevant`. Backslash перед underscore в примерах из переписки — артефакт Markdown, не допустимая escape-последовательность JSON.

## Уровень 1 — backend → Gemini

```json
{
  "university_name": "Nazarbayev University",
  "image_url": "https://example.com/photo123.jpg",
  "image_context": "Название из поиска, ссылка на источник, местоположение, доступный текст страницы и результаты проверки источника"
}
```

Этот объект передаётся текстовой частью запроса `generateContent`. Отдельная часть `inlineData` содержит настоящий JPEG после декодирования/уменьшения изображения. Ссылка не выдаётся за просмотренное изображение. Системный prompt отделён от недоверенного контекста.

## Уровень 2 — Gemini → backend, одна фотография

```json
{
  "category": "dormitory",
  "is_relevant": true,
  "confidence": 0.82,
  "reasoning": "The context links the dormitory photograph to the university, but the source is not official.",
  "duplicate_risk": "unknown",
  "tags": ["dormitory", "student_life"]
}
```

Здесь `category` — `campus | dormitory | classroom | library | city`. Backend переводит единственное число в ключи галереи `dormitories`, `classrooms`, `libraries`.

Теги: `dormitory`, `sports`, `laboratories`, `student_life`, `architecture`, `outdoor`, `indoor`. Никакого назначения всех тегов каждой карточке. `confidence` — число [0,1], `is_relevant` — boolean. `duplicate_risk`: `low | medium | high | unknown`. Невалидные значения не приводятся автоматически и не публикуются.

## Уровень 3 — backend → frontend

Примеры ниже иллюстрируют контракт, не являются реальными результатами поиска. Все пять массивов категорий присутствуют, включая пустые.

```json
{
  "status": "success",
  "university_name": "Example University",
  "location": "Example City",
  "description": "Description grounded in retrieved search results.",
  "description_sources": ["https://example.edu/about"],
  "categories": {
    "campus": [],
    "dormitories": [
      {
        "id": "photo_1",
        "title": "Student dormitory",
        "image_url": "https://images.example.com/photo.jpg",
        "source": "https://example.com/dormitory-article",
        "date": "2026-09-18",
        "date_kind": "retrieved",
        "verification_status": "limited_verification",
        "confidence": 0.82,
        "reasoning": "The context links the dormitory photograph to the university, but the source is not official.",
        "tags": ["dormitory", "student_life"],
        "category": "dormitories",
        "verification_method": "AI image assessment + available source context; affiliation not independently confirmed",
        "duplicate_risk": "unknown"
      }
    ],
    "classrooms": [],
    "libraries": [],
    "city": []
  },
  "data_quality": "limited",
  "warnings": ["Not enough supported photographs were found."],
  "missing_categories": ["campus", "classrooms", "libraries", "city"],
  "stats": {
    "found": 10,
    "assessed": 5,
    "accepted": 1,
    "duplicates_removed": 2,
    "rejected": 4,
    "unavailable": 0,
    "elapsed_ms": 23000
  },
  "generated_at": "2026-09-18T12:00:00.000Z"
}
```

`reasoning` переносится из второго уровня **без изменения строки**. `source` содержит полный HTTP(S) URL страницы; hostname для отображения вычисляет frontend. `date_kind` явно отличает найденную дату публикации от текущей даты получения.

Важное исправление примера из переписки: `studentlife.mit.edu` является поддоменом `mit.edu`. Проверка домена в коде это учитывает; контекст не объявляет такой источник неофициальным автоматически.

Альтернативные конечные ответы:

```json
{
  "status": "disambiguation_needed",
  "query": "MIT",
  "candidates": [
    {
      "id": "stable_hash",
      "name": "Massachusetts Institute of Technology",
      "location": "Cambridge, Massachusetts, United States",
      "selection_token": "server-signed-payload.signature"
    }
  ]
}
```

При реальной неоднозначности candidates содержит не менее двух вариантов. `selection_token` нельзя конструировать на клиенте: он подписан сервером и истекает через 10 минут.

```json
{
  "status": "not_found",
  "query": "Xyzabc University",
  "suggestions": [
    "Harvard University",
    "Stanford University",
    "University of Oxford"
  ]
}
```

```json
{
  "status": "error",
  "error_code": "SEARCH_API_UNAVAILABLE",
  "message": "Image search is temporarily unavailable. Please try again."
}
```

`not_found` означает, что университет не удалось определить по источникам. Ошибка поиска не превращается в `not_found`. Университет без фотографий возвращает `success` с `data_quality: limited`, пустыми массивами и предупреждениями.

## HTTP transport

### POST /api/jobs

```json
{ "university_name": "Nazarbayev University" }
```

Ответ HTTP 202:

```json
{ "job_id": "opaque-random-id" }
```

При выборе кандидата повторите POST:

```json
{
  "university_name": "Massachusetts Institute of Technology",
  "selection_token": "token-from-candidate"
}
```

### GET /api/jobs/:job_id

До завершения — только транспортное состояние:

```json
{
  "status": "processing",
  "progress": {
    "stage": "verifying",
    "found": 47,
    "assessed": 12,
    "accepted": 8,
    "elapsed_ms": 13500
  }
}
```

`processing` не заменяет четыре конечных варианта контракта. После завершения endpoint возвращает прямо один из ответов уровня 3. Frontend опрашивает endpoint примерно раз в 650 мс. Задание живёт до 10 минут, после чего возвращается `JOB_EXPIRED`.

### DELETE /api/jobs/:job_id

Отмена и удаление задания; HTTP 204. Незавершённые внешние запросы получают abort.

### GET /api/health

```json
{ "status": "ok", "configured": false }
```

`configured` показывает только наличие ключей в окружении, не их валидность и не баланс API.

### Коды ошибок

| Код                                                                        | Значение                                   |
| -------------------------------------------------------------------------- | ------------------------------------------ |
| `SERVER_NOT_CONFIGURED`                                                    | Не заданы оба ключа                        |
| `INVALID_REQUEST`                                                          | Некорректный входной JSON                  |
| `SEARCH_API_UNAVAILABLE`, `SEARCH_RATE_LIMITED`, `SEARCH_INVALID_RESPONSE` | Ошибка Serper                              |
| `AI_API_UNAVAILABLE`, `AI_RATE_LIMITED`, `AI_INVALID_RESPONSE`             | Ошибка Gemini / модели / JSON              |
| `DEADLINE_EXCEEDED`                                                        | В бюджет не получен полезный результат     |
| `SELECTION_EXPIRED`                                                        | Вариант выбора устарел или подпись неверна |
| `JOB_EXPIRED`                                                              | Нет такого активного задания               |
| `RATE_LIMITED`, `SERVER_BUSY`                                              | Локальные ограничения нагрузки             |
| `ORIGIN_NOT_ALLOWED`                                                       | Неправильный origin; проверьте APP_ORIGIN  |
| `CONNECTION_ERROR`                                                         | Клиент не смог получить корректный ответ   |

Frontend не получает ключи, внутренние provider payloads, стек исключения или неподтверждённые поля вне контракта.


## Progressive polling

`GET /api/jobs/:id` may return `{ "status": "processing", "progress": {...}, "partial": <SuccessResult> }`. `partial` is absent until the first accepted photograph. It is a snapshot, not the final result; continue polling until the outer status is no longer `processing`. Its `generated_at` remains stable for the job. A final success may include `diagnostics`: candidates_selected, page_fetches, page_reuses, download_failed, ai_failed, first_photo_ms (nullable), budget_exhausted. Failures exclude work cancelled by the overall deadline. Three LLM/input/profile layers remain separate.
