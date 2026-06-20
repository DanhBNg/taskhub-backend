const ALLOWED_SUGGESTED_ACTIONS = [
  'SUMMARIZE',
  'CREATE_TASK',
  'FIND_TASK',
  'PRIORITIZE',
];

function normalizeSuggestedActions(actions) {
  if (!Array.isArray(actions)) return [];

  return actions
    .map((action) => String(action || '').trim().toUpperCase())
    .filter((action) => ALLOWED_SUGGESTED_ACTIONS.includes(action))
    .filter((action, index, array) => array.indexOf(action) === index)
    .slice(0, 4);
}

function parseJsonFromText(rawText, fallbackValue) {
  if (!rawText || typeof rawText !== 'string') return fallbackValue;

  try {
    return JSON.parse(rawText);
  } catch (error) {
    const firstObject = rawText.indexOf('{');
    const lastObject = rawText.lastIndexOf('}');
    const firstArray = rawText.indexOf('[');
    const lastArray = rawText.lastIndexOf(']');

    const canReadObject =
      firstObject !== -1 && lastObject !== -1 && lastObject > firstObject;
    const canReadArray =
      firstArray !== -1 && lastArray !== -1 && lastArray > firstArray;

    if (canReadArray && (!canReadObject || firstArray < firstObject)) {
      return JSON.parse(rawText.substring(firstArray, lastArray + 1));
    }

    if (canReadObject) {
      return JSON.parse(rawText.substring(firstObject, lastObject + 1));
    }

    throw error;
  }
}

function normalizeAssistantResponse(rawText) {
  const parsed = parseJsonFromText(rawText, {});

  return {
    reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '',
    suggestedActions: normalizeSuggestedActions(parsed.suggestedActions),
  };
}

function normalizeGeneratedTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) return [];

  return rawTasks
    .slice(0, 5)
    .map((task) => ({
      title: String(task.title || '').trim(),
      description: String(task.description || '').trim(),
      priority: ['High', 'Medium', 'Low'].includes(task.priority)
        ? task.priority
        : 'Medium',
    }))
    .filter((task) => task.title.length > 0);
}

function normalizeTaskInsights(rawTasks) {
  if (!Array.isArray(rawTasks)) return [];

  return rawTasks
    .slice(0, 8)
    .map((task, index) => ({
      title: String(task.title || task.taskName || '').trim(),
      projectName: String(task.projectName || '').trim(),
      status: String(task.status || '').trim(),
      priority: String(task.priority || '').trim(),
      dueDate: String(task.dueDate || '').trim(),
      reason: String(task.reason || task.matchReason || '').trim(),
      rank: Number.isInteger(task.rank) ? task.rank : index + 1,
    }))
    .filter((task) => task.title.length > 0);
}

module.exports = {
  ALLOWED_SUGGESTED_ACTIONS,
  normalizeSuggestedActions,
  parseJsonFromText,
  normalizeAssistantResponse,
  normalizeGeneratedTasks,
  normalizeTaskInsights,
};
