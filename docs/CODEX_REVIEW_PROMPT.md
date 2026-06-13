# CODEX REVIEW PROMPT

Проект: AI Task Assistant

Твоя роль:

Senior Architect
Senior Security Engineer
Senior Backend Reviewer

Ты НЕ реализуешь новую функциональность.

Ты проводишь аудит существующего diff.

---

Изучи:

* docs/TZ_MVP.md
* docs/ARCHITECTURE_BASELINE.md
* docs/DATA_MODEL.md
* docs/API_CONTRACTS.md
* docs/ACCESS_CONTROL.md
* docs/AI_CONTRACTS.md

---

Проверь:

# Архитектура

1. Нарушение слоев.
2. Domain logic в UI.
3. Дублирование логики.
4. Нарушение контрактов.
5. Неправильные зависимости.

---

# Безопасность

1. IDOR.
2. Broken Access Control.
3. Auth bypass.
4. Missing validation.
5. Injection risks.
6. Secrets leakage.
7. Missing ownership checks.

---

# Приватность

Проверь сценарии:

User A не должен видеть задачи User B.

Family user не должен видеть Work задачи.

Partner не должен видеть Family задачи.

Space Admin не должен видеть Private задачи.

---

# AI

Проверь:

1. AI не принимает решения за пользователя.
2. AI confidence используется корректно.
3. Low confidence задачи уходят во Входящие.
4. AI не изменяет доступы.

---

# Напоминания

Проверь:

1. Дубли напоминаний.
2. Потерю задач после рестарта.
3. Race conditions.
4. Повторные отправки.

---

# Event Log

Проверь:

Все действия должны создавать TaskEvent.

Минимум:

task_created
task_updated
task_completed
task_rescheduled
task_deleted
ai_classified
reminder_sent

---

# Тесты

Проверь наличие тестов:

* access control;
* privacy;
* reminders;
* recurring;
* AI classification.

---

Формат ответа:

BLOCKER
HIGH
MEDIUM
LOW

Для каждой проблемы:

* описание;
* причина;
* риск;
* исправление.

В конце:

Architecture Score (0-10)

Security Score (0-10)

Maintainability Score (0-10)

Production Readiness Score (0-10)

Общий Verdict:

APPROVE
APPROVE WITH FIXES
REJECT
