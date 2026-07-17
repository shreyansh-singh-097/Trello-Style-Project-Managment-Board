// ==========================================================================
// FLOWBOARD — script.js
// Task Management: Add Task · Edit Task · Delete Task · Dynamic Rendering ·
//                   Column Counts · Local Storage
// Drag & Drop: move task cards between columns (HTML5 Drag and Drop API)
// Activity Log: records Created / Edited / Deleted / Moved / Assignee
//               Changed / Deadline Updated events, newest first
// Search & Filter: live title search + priority/assignee/due-status filter,
//                   combinable, no DOM re-render needed
// Deadline Colors: green / yellow / red due-date badges, recalculated on
//                   every render
// Team Avatars: auto-generated colors for any assignee, with a hook for
//               real profile photos later (AVATAR_IMAGES)
// Performance: CRUD/drag actions re-render only the column(s) that actually
//              changed instead of the whole board (see renderColumn())
// Accessibility: keyboard-focusable cards, aria-labels, live regions,
//                 labeled form errors
// ==========================================================================

/* --------------------------------------------------------------------
   1. STATE
   -------------------------------------------------------------------- */

// The single source of truth for every task on the board.
// Each task looks like:
// { id, title, description, assignee, dueDate, priority, status, createdAt, updatedAt }
let tasks = [];

// Which task is currently open in the Add/Edit modal ("" means "adding a new task")
let currentEditId = "";

// Which task is pending deletion while the confirm dialog is open
let pendingDeleteId = "";

// The single source of truth for the Activity Log (newest first).
// Each activity looks like: { id, type, message, time }
let activities = [];

// The id of the task currently being dragged (set on dragstart, cleared on dragend)
let draggedTaskId = "";

// Current search text (lowercased) and active filter value, e.g. "priority:high".
// Both are applied together whenever either one changes.
let searchQuery = "";
let activeFilter = "all";

// The five column statuses, in board order. Kept in one place so every
// function (render, counts, seed data) stays in sync with the columns in index.html.
const STATUSES = ["backlog", "todo", "in-progress", "review", "done"];

// Friendly label shown in a card's footer for each status.
const STATUS_LABELS = {
  "backlog": "Not started",
  "todo": "Not started",
  "in-progress": "In progress",
  "review": "Needs review",
  "done": "Completed"
};

// Friendly column names, used in Activity Log messages (e.g. "moved from Backlog to Review").
const COLUMN_LABELS = {
  "backlog": "Backlog",
  "todo": "To Do",
  "in-progress": "In Progress",
  "review": "Review",
  "done": "Done"
};

// Consistent avatar colors for known team members (matches original design).
const AVATAR_COLORS = {
  "John Park": "#4361EE",
  "Priya Nair": "#7C5CFC",
  "Mike Chen": "#0BA5A0",
  "Sarah Lee": "#E0673C"
};
const DEFAULT_AVATAR_COLOR = "#9AA1BD"; // used for "Unassigned"

// Optional profile photos, keyed by full name. Empty for now — no image
// upload exists yet, so every avatar currently falls back to initials.
// Populate this (e.g. AVATAR_IMAGES["John Park"] = "https://...jpg") and
// renderAvatar() will automatically show the photo instead of initials.
const AVATAR_IMAGES = {};

// Curated palette used to auto-generate a color for any assignee name that
// isn't in AVATAR_COLORS above, so new team members always get a distinct,
// good-looking color instead of falling back to plain gray.
const AVATAR_PALETTE = [
  "#4361EE", "#7C5CFC", "#0BA5A0", "#E0673C",
  "#D1345B", "#2E9CCA", "#E8A33D", "#8854D0", "#16A085", "#C2547A"
];

// Turns a name into a deterministic index into AVATAR_PALETTE, so the same
// name always maps to the same color across the whole app.
function generateColorFromName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// Avatar colors for Activity Log entries, keyed by first name (seed data uses
// first names only). Falls back to the primary blue for "You" and anyone else.
const ACTOR_COLORS = {
  "John": "#4361EE",
  "Priya": "#7C5CFC",
  "Mike": "#0BA5A0",
  "Sarah": "#E0673C"
};
const DEFAULT_ACTOR_COLOR = "#4361EE";

const STORAGE_KEY = "flowboard_tasks";
const ACTIVITY_STORAGE_KEY = "flowboard_activity";

/* --------------------------------------------------------------------
   2. DOM REFERENCES
   -------------------------------------------------------------------- */

const boardEl = document.getElementById("board");
const activityListEl = document.getElementById("activityList");

const addTaskBtn = document.getElementById("addTaskBtn");
const searchInputEl = document.getElementById("searchInput");
const filterSelectEl = document.getElementById("filterSelect");

const taskModalOverlay = document.getElementById("taskModalOverlay");
const taskModalTitle = document.getElementById("taskModalTitle");
const taskModalSubmitBtn = document.getElementById("taskModalSubmitBtn");
const taskModalCloseBtn = document.getElementById("taskModalCloseBtn");
const taskModalCancelBtn = document.getElementById("taskModalCancelBtn");

const taskForm = document.getElementById("taskForm");
const taskIdInput = document.getElementById("taskId");
const taskTitleInput = document.getElementById("taskTitle");
const taskDescriptionInput = document.getElementById("taskDescription");
const taskAssigneeInput = document.getElementById("taskAssignee");
const taskPriorityInput = document.getElementById("taskPriority");
const taskDueDateInput = document.getElementById("taskDueDate");

const taskTitleError = document.getElementById("taskTitleError");
const taskDueDateError = document.getElementById("taskDueDateError");

const deleteModalOverlay = document.getElementById("deleteModalOverlay");
const deleteTaskNameEl = document.getElementById("deleteTaskName");
const deleteModalCancelBtn = document.getElementById("deleteModalCancelBtn");
const deleteModalConfirmBtn = document.getElementById("deleteModalConfirmBtn");

/* --------------------------------------------------------------------
   3. LOCAL STORAGE
   -------------------------------------------------------------------- */

// Reads tasks from localStorage. Falls back to starter sample data
// the very first time the app runs (so the board isn't empty).
function loadTasks() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return getSeedTasks();
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : getSeedTasks();
  } catch (error) {
    // Corrupted data — start fresh rather than crash the app.
    console.error("Could not parse saved tasks, using starter data instead.", error);
    return getSeedTasks();
  }
}

// Saves the current in-memory `tasks` array to localStorage.
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// Starter tasks shown the first time someone opens the board
// (kept close to the original static design mock).
function getSeedTasks() {
  return [
    {
      id: "task-1",
      title: "Research competitor dashboards",
      description: "Collect screenshots and notes on similar tools before wireframing starts.",
      assignee: "Priya Nair",
      dueDate: "2026-08-14",
      priority: "low",
      status: "backlog",
      createdAt: "2026-07-10T09:00:00",
      updatedAt: "2026-07-10T09:00:00"
    },
    {
      id: "task-2",
      title: "Draft onboarding copy",
      description: "First-run copy for empty states and the welcome tour tooltips.",
      assignee: "Mike Chen",
      dueDate: "2026-08-20",
      priority: "medium",
      status: "backlog",
      createdAt: "2026-07-14T11:30:00",
      updatedAt: "2026-07-14T11:30:00"
    },
    {
      id: "task-3",
      title: "Fix Navbar Bug",
      description: "Dropdown menu collapses incorrectly on mobile Safari.",
      assignee: "Sarah Lee",
      dueDate: "2026-07-18",
      priority: "high",
      status: "todo",
      createdAt: "2026-07-15T08:15:00",
      updatedAt: "2026-07-15T08:15:00"
    },
    {
      id: "task-4",
      title: "Client Dashboard",
      description: "Build the summary widgets and the weekly activity chart.",
      assignee: "John Park",
      dueDate: "2026-07-12",
      priority: "high",
      status: "in-progress",
      createdAt: "2026-07-08T10:00:00",
      updatedAt: "2026-07-14T17:03:00"
    },
    {
      id: "task-5",
      title: "Landing Page Design",
      description: "Awaiting feedback from design lead on hero section spacing.",
      assignee: "Priya Nair",
      dueDate: "2026-07-17",
      priority: "medium",
      status: "review",
      createdAt: "2026-07-09T09:00:00",
      updatedAt: "2026-07-15T09:42:00"
    },
    {
      id: "task-6",
      title: "Set up project repo",
      description: "Initialized repository with folder structure and README.",
      assignee: "Mike Chen",
      dueDate: "2026-07-05",
      priority: "low",
      status: "done",
      createdAt: "2026-07-01T09:00:00",
      updatedAt: "2026-07-13T14:52:00"
    }
  ];
}

// Reads the Activity Log from localStorage. Falls back to starter sample
// entries the very first time the app runs (so the log isn't empty).
function loadActivity() {
  const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);

  if (!raw) {
    return getSeedActivities();
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : getSeedActivities();
  } catch (error) {
    console.error("Could not parse saved activity, using starter data instead.", error);
    return getSeedActivities();
  }
}

// Saves the current in-memory `activities` array to localStorage.
function saveActivity() {
  localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activities));
}

// Starter activity entries shown the first time someone opens the board
// (kept close to the original static design mock). Newest first.
function getSeedActivities() {
  return [
    { id: "activity-1", type: "moved", message: 'John moved "Landing Page Design" to Review', time: "2026-07-15T09:42:00" },
    { id: "activity-2", type: "assignee", message: 'Sarah assigned "Fix Navbar Bug" to Mike', time: "2026-07-15T08:15:00" },
    { id: "activity-3", type: "deadline", message: 'Mike updated the deadline for "Client Dashboard"', time: "2026-07-14T17:03:00" },
    { id: "activity-4", type: "created", message: 'Priya created task "Draft onboarding copy"', time: "2026-07-14T11:30:00" },
    { id: "activity-5", type: "moved", message: 'John moved "Set up project repo" to Done', time: "2026-07-13T14:52:00" }
  ];
}

/* --------------------------------------------------------------------
   4. RENDERING
   -------------------------------------------------------------------- */

// Renders the whole board: rebuilds every column, then re-applies whatever
// search/filter is currently active. Used on initial load; day-to-day task
// changes call renderColumn() instead so they only touch the column(s)
// that actually changed (see PERFORMANCE notes near createTask/moveTask).
function renderBoard() {
  STATUSES.forEach(renderColumn);
  applySearchAndFilter();
}

// Rebuilds a single column's task list and its count badge. This is the
// building block every CRUD/drag-drop action uses instead of re-rendering
// the entire board for a change that only affects one or two columns.
function renderColumn(status) {
  const listEl = document.querySelector('.task-list[data-tasklist="' + status + '"]');
  if (!listEl) return;

  listEl.innerHTML = "";

  const tasksInColumn = tasks.filter(function (task) {
    return task.status === status;
  });

  if (tasksInColumn.length === 0) {
    listEl.appendChild(renderEmptyState());
  } else {
    tasksInColumn.forEach(function (task) {
      listEl.appendChild(renderTaskCard(task));
    });
  }

  updateTaskCount(status);
}

// Small placeholder shown when a column has no tasks.
function renderEmptyState() {
  const emptyEl = document.createElement("p");
  emptyEl.className = "task-list-empty";
  emptyEl.textContent = "No tasks here yet.";
  return emptyEl;
}

// Builds one <article class="task-card"> element for a given task object.
// Markup mirrors the original static design exactly, just filled in with data.
function renderTaskCard(task) {
  const article = document.createElement("article");
  article.className = "task-card" + (task.status === "done" ? " is-done" : "");
  article.setAttribute("data-priority", task.priority);
  article.setAttribute("data-task-id", task.id);
  article.setAttribute("draggable", "true"); // drag & drop handled via event delegation on #board
  article.setAttribute("tabindex", "0"); // keyboard focusable — Enter/Space opens Edit (see boardEl keydown listener)
  article.setAttribute(
    "aria-label",
    task.title + ", " + task.priority + " priority, assigned to " +
      (task.assignee || "Unassigned") + ", " + (STATUS_LABELS[task.status] || task.status)
  );

  const stripEl = document.createElement("div");
  stripEl.className = "card-priority-strip strip-" + task.priority;
  stripEl.setAttribute("aria-hidden", "true");
  article.appendChild(stripEl);

  const bodyEl = document.createElement("div");
  bodyEl.className = "card-body";

  // ---- Title + edit/delete actions ----
  const topEl = document.createElement("div");
  topEl.className = "card-top";

  const titleEl = document.createElement("h3");
  titleEl.className = "card-title";
  titleEl.textContent = task.title;
  topEl.appendChild(titleEl);

  const actionsEl = document.createElement("div");
  actionsEl.className = "card-actions";
  actionsEl.innerHTML =
    '<button class="icon-btn" type="button" data-action="edit" aria-label="Edit task">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5L13.5 4.5L5 13H3V11L11.5 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>' +
    '</button>' +
    '<button class="icon-btn icon-btn-danger" type="button" data-action="delete" aria-label="Delete task">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4.5H13M6.5 4.5V3H9.5V4.5M4.5 4.5L5 13H11L11.5 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '</button>';
  topEl.appendChild(actionsEl);
  bodyEl.appendChild(topEl);

  // ---- Description ----
  if (task.description) {
    const descEl = document.createElement("p");
    descEl.className = "card-desc";
    descEl.textContent = task.description;
    bodyEl.appendChild(descEl);
  }

  // ---- Priority badge + due date ----
  const metaEl = document.createElement("div");
  metaEl.className = "card-meta";

  const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
  const badgeEl = document.createElement("span");
  badgeEl.className = "priority-badge badge-" + task.priority;
  badgeEl.textContent = priorityLabel;
  metaEl.appendChild(badgeEl);

  if (task.dueDate) {
    const dueEl = document.createElement("span");
    // Green (due-far) / Yellow (due-soon) / Red (due-overdue), recalculated
    // from today's date every time the card is rendered.
    dueEl.className = "due-date " + updateDeadlineColor(task.dueDate);
    dueEl.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 6.5H13.5M5.5 2V4M10.5 2V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' +
      formatDateDisplay(task.dueDate);
    metaEl.appendChild(dueEl);
  }

  bodyEl.appendChild(metaEl);

  // ---- Footer: status + avatar ----
  const footerEl = document.createElement("footer");
  footerEl.className = "card-footer";

  const statusEl = document.createElement("span");
  statusEl.className = "status-text";
  statusEl.textContent = STATUS_LABELS[task.status] || "";
  footerEl.appendChild(statusEl);

  footerEl.appendChild(renderAvatar(task.assignee));

  bodyEl.appendChild(footerEl);
  article.appendChild(bodyEl);

  return article;
}

// Updates the numeric badge in one column's header to match the current task count.
function updateTaskCount(status) {
  const columnEl = document.querySelector('.column[data-column="' + status + '"]');
  if (!columnEl) return;

  const countEl = columnEl.querySelector(".task-count");
  if (!countEl) return;

  const count = tasks.filter(function (task) {
    return task.status === status;
  }).length;

  countEl.textContent = count;
  countEl.setAttribute("aria-label", count + (count === 1 ? " task" : " tasks"));
}

/* --------------------------------------------------------------------
   4b. ACTIVITY LOG RENDERING
   -------------------------------------------------------------------- */

// Rebuilds the Activity Log panel from the `activities` array (newest first).
function renderActivity() {
  if (!activityListEl) return;

  activityListEl.innerHTML = "";

  activities.forEach(function (activity) {
    activityListEl.appendChild(renderActivityItem(activity));
  });
}

// Builds one <li class="activity-item"> element for a given activity object.
// Markup mirrors the original static design (avatar + text + timestamp).
function renderActivityItem(activity) {
  const li = document.createElement("li");
  li.className = "activity-item";

  // The actor is simply the first word of the message (e.g. "You", "John"),
  // used to pick a matching avatar color/initials.
  const actorName = activity.message.split(" ")[0];

  const avatarEl = document.createElement("span");
  avatarEl.className = "avatar avatar-sm";
  avatarEl.style.setProperty(
    "--avatar-color",
    ACTOR_COLORS[actorName] || (actorName === "You" ? DEFAULT_ACTOR_COLOR : generateColorFromName(actorName))
  );
  avatarEl.title = actorName;
  avatarEl.textContent = getInitials(actorName);
  li.appendChild(avatarEl);

  const contentEl = document.createElement("div");
  contentEl.className = "activity-content";

  const textEl = document.createElement("p");
  textEl.className = "activity-text";
  textEl.textContent = activity.message;
  contentEl.appendChild(textEl);

  const timeEl = document.createElement("time");
  timeEl.className = "activity-time";
  timeEl.textContent = formatActivityTime(activity.time);
  contentEl.appendChild(timeEl);

  li.appendChild(contentEl);
  return li;
}

// Adds a new activity to the top of the log, then saves and re-renders it.
function createActivity(type, message) {
  const activity = {
    id: generateId(),
    type: type,
    message: message,
    time: new Date().toISOString()
  };

  activities.unshift(activity); // latest activity always appears first
  saveActivity();
  renderActivity();
}

// Turns an ISO timestamp into "Just now" / "X min ago" / a clock time,
// matching the "10:25 AM OR 2 min ago" format from the brief.
function formatActivityTime(isoString) {
  const then = new Date(isoString);
  const diffMinutes = Math.floor((Date.now() - then.getTime()) / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return diffMinutes + " min ago";

  return then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* --------------------------------------------------------------------
   5. SMALL HELPERS
   -------------------------------------------------------------------- */

// Generates a reasonably unique id for a new task.
function generateId() {
  return "task-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
}

// Turns "2026-07-18" into a "Jul 18" display string without timezone drift.
function formatDateDisplay(isoDateString) {
  const parts = isoDateString.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const date = new Date(year, month, day);

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Returns initials for an avatar, e.g. "Priya Nair" -> "PN". Falls back to "NA".
function getInitials(name) {
  if (!name || !name.trim()) return "NA";

  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return (words[0][0] + words[1][0]).toUpperCase();
}

// Looks up a consistent avatar color for a given assignee name: a hand-picked
// color for known team members, an auto-generated one for anyone else, and
// flat gray only for "Unassigned".
function getAvatarColor(name) {
  if (!name) return DEFAULT_AVATAR_COLOR;
  return AVATAR_COLORS[name] || generateColorFromName(name);
}

// Builds one avatar element (an <img> if a profile photo is known, otherwise
// initials on a colored circle). Used for both task-card and Activity Log avatars.
function renderAvatar(name, extraClass) {
  const className = "avatar" + (extraClass ? " " + extraClass : "");
  const imageUrl = name ? AVATAR_IMAGES[name] : null;

  if (imageUrl) {
    const img = document.createElement("img");
    img.className = className;
    img.src = imageUrl;
    img.alt = name;
    return img;
  }

  const span = document.createElement("span");
  span.className = className;
  span.style.setProperty("--avatar-color", getAvatarColor(name));
  span.title = name || "Unassigned";
  span.textContent = getInitials(name);
  return span;
}

// Returns today's date as a Date object with the time zeroed out,
// so due-date comparisons only consider the calendar day.
function getTodayAtMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Whole number of days between today and a "YYYY-MM-DD" due date.
// Negative means the date has already passed.
function getDaysUntilDueDate(dueDateString) {
  const parts = dueDateString.split("-");
  const due = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const diffMs = due.getTime() - getTodayAtMidnight().getTime();
  return Math.round(diffMs / 86400000); // 86,400,000 ms in a day
}

// Deadline color-coding: red once the date has passed, yellow inside the
// next 3 days, green for anything further out. Recalculated on every render,
// so colors are always accurate — including right after the page reloads.
function updateDeadlineColor(dueDateString) {
  if (!dueDateString) return "due-far";

  const daysLeft = getDaysUntilDueDate(dueDateString);
  if (daysLeft < 0) return "due-overdue";
  if (daysLeft <= 3) return "due-soon";
  return "due-far";
}

/* --------------------------------------------------------------------
   6. FORM VALIDATION
   -------------------------------------------------------------------- */

// Validates the Add/Edit form. Returns { isValid, errors } where
// `errors` has a message per invalid field (empty string = no error).
function validateForm(title, dueDate) {
  const errors = { title: "", dueDate: "" };

  if (!title || !title.trim()) {
    errors.title = "Task title is required.";
  }

  if (dueDate) {
    const parts = dueDate.split("-");
    const selected = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

    if (selected < getTodayAtMidnight()) {
      errors.dueDate = "Due date cannot be in the past.";
    }
  }

  const isValid = !errors.title && !errors.dueDate;
  return { isValid: isValid, errors: errors };
}

// Displays validation errors on the form (or clears them if empty).
function showFormErrors(errors) {
  taskTitleError.textContent = errors.title;
  taskTitleInput.classList.toggle("has-error", Boolean(errors.title));

  taskDueDateError.textContent = errors.dueDate;
  taskDueDateInput.classList.toggle("has-error", Boolean(errors.dueDate));
}

function clearFormErrors() {
  showFormErrors({ title: "", dueDate: "" });
}

/* --------------------------------------------------------------------
   7. TASK CRUD
   -------------------------------------------------------------------- */

// Creates a new task from form data and adds it to the board.
function createTask(data) {
  const now = new Date().toISOString();

  const newTask = {
    id: generateId(),
    title: data.title.trim(),
    description: data.description.trim(),
    assignee: data.assignee,
    dueDate: data.dueDate,
    priority: data.priority,
    status: "backlog", // new tasks always start in Backlog, per the PRD
    createdAt: now,
    updatedAt: now
  };

  tasks.push(newTask);
  saveTasks();
  renderColumn(newTask.status); // only the Backlog column changed
  applySearchAndFilter();

  createActivity("created", 'You created task "' + newTask.title + '"');
}

// Updates an existing task's editable fields (title, description, assignee,
// due date, priority). Status is left untouched here — moving tasks between
// columns is handled separately by moveTask() via drag & drop.
function editTask(id, data) {
  const task = tasks.find(function (t) {
    return t.id === id;
  });
  if (!task) return;

  // Remember the "before" values so we can log exactly what changed.
  const previous = {
    title: task.title,
    description: task.description,
    assignee: task.assignee,
    dueDate: task.dueDate,
    priority: task.priority
  };

  task.title = data.title.trim();
  task.description = data.description.trim();
  task.assignee = data.assignee;
  task.dueDate = data.dueDate;
  task.priority = data.priority;
  task.updatedAt = new Date().toISOString();

  saveTasks();
  renderColumn(task.status); // edits never change status, so only this column needs rebuilding
  applySearchAndFilter();
  logEditActivities(task, previous);
}

// Compares a task's old and new values and creates one Activity Log entry
// per kind of change (assignee, deadline, and/or general edit details).
function logEditActivities(task, previous) {
  if (previous.assignee !== task.assignee) {
    const fromName = previous.assignee || "Unassigned";
    const toName = task.assignee || "Unassigned";
    createActivity(
      "assignee",
      'You changed the assignee for "' + task.title + '" from ' + fromName + " to " + toName
    );
  }

  if (previous.dueDate !== task.dueDate) {
    const toDate = task.dueDate ? formatDateDisplay(task.dueDate) : "no due date";
    createActivity("deadline", 'You updated the deadline for "' + task.title + '" to ' + toDate);
  }

  const detailsChanged =
    previous.title !== task.title ||
    previous.description !== task.description ||
    previous.priority !== task.priority;

  if (detailsChanged) {
    createActivity("edited", 'You edited task "' + task.title + '"');
  }
}

// Removes a task from the board permanently.
function deleteTask(id) {
  const task = tasks.find(function (t) {
    return t.id === id;
  });
  const title = task ? task.title : "a task";
  const status = task ? task.status : null;

  tasks = tasks.filter(function (t) {
    return t.id !== id;
  });

  saveTasks();
  if (status) renderColumn(status); // only the column the task was removed from changed
  applySearchAndFilter();

  createActivity("deleted", 'You deleted task "' + title + '"');
}

/* --------------------------------------------------------------------
   7b. DRAG & DROP — MOVING TASKS BETWEEN COLUMNS
   -------------------------------------------------------------------- */

// Sets a task's status field to a new column value.
function updateTaskStatus(task, newStatus) {
  task.status = newStatus;
  task.updatedAt = new Date().toISOString();
}

// Moves a task to a new column: updates its status, saves, re-renders only
// the source and destination columns (both counts update), and logs the move.
function moveTask(id, newStatus) {
  const task = tasks.find(function (t) {
    return t.id === id;
  });
  if (!task) return;
  if (task.status === newStatus) return; // dropped back into the same column — nothing to do

  const oldStatus = task.status;
  updateTaskStatus(task, newStatus);

  saveTasks();
  renderColumn(oldStatus); // only the source and destination columns changed
  renderColumn(newStatus);
  applySearchAndFilter();

  createActivity(
    "moved",
    'You moved "' + task.title + '" from ' + COLUMN_LABELS[oldStatus] + " to " + COLUMN_LABELS[newStatus]
  );
}

/* --------------------------------------------------------------------
   7c. SEARCH & FILTER
   -------------------------------------------------------------------- */

// Called on every keystroke in the search box. Cards are shown/hidden
// instantly via CSS — no re-render needed, so search stays fast.
function searchTasks(query) {
  searchQuery = (query || "").trim().toLowerCase();
  applySearchAndFilter();
}

// Called whenever the filter dropdown changes.
function filterTasks(value) {
  activeFilter = value || "all";
  applySearchAndFilter();
}

// Applies the current search text AND the current filter together to every
// task card currently in the DOM. A card must satisfy both to stay visible.
function applySearchAndFilter() {
  document.querySelectorAll(".task-card").forEach(function (cardEl) {
    const task = tasks.find(function (t) {
      return t.id === cardEl.getAttribute("data-task-id");
    });
    if (!task) return;

    const isVisible = taskMatchesSearch(task) && taskMatchesFilter(task);
    cardEl.classList.toggle("is-hidden", !isVisible);
  });

  updateEmptyFilterMessages();
}

// True when the task's title contains the current search text
// (or when the search box is empty — everything matches then).
function taskMatchesSearch(task) {
  if (!searchQuery) return true;
  return task.title.toLowerCase().indexOf(searchQuery) !== -1;
}

// True when the task satisfies the active filter. Filter values look like
// "priority:high", "assignee:John Park", or "due:overdue" (see index.html).
function taskMatchesFilter(task) {
  if (!activeFilter || activeFilter === "all") return true;

  const separatorIndex = activeFilter.indexOf(":");
  const filterType = activeFilter.slice(0, separatorIndex);
  const filterValue = activeFilter.slice(separatorIndex + 1);

  if (filterType === "priority") return task.priority === filterValue;
  if (filterType === "assignee") return (task.assignee || "") === filterValue;
  if (filterType === "due") return getDueBucket(task.dueDate) === filterValue;

  return true;
}

// Buckets a due date into "overdue" / "today" / "upcoming" for the Due
// Status filter. Tasks with no due date never match a due-status filter.
function getDueBucket(dueDate) {
  if (!dueDate) return null;

  const daysLeft = getDaysUntilDueDate(dueDate);
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "today";
  return "upcoming";
}

// Shows a small "No matching tasks." note in any column where every task
// got filtered out (but the column isn't genuinely empty) — and removes
// that note again as soon as it no longer applies.
function updateEmptyFilterMessages() {
  STATUSES.forEach(function (status) {
    const listEl = document.querySelector('.task-list[data-tasklist="' + status + '"]');
    if (!listEl) return;

    const existingMessage = listEl.querySelector("[data-filter-empty]");
    if (existingMessage) existingMessage.remove();

    const cardEls = listEl.querySelectorAll(".task-card");
    if (cardEls.length === 0) return; // genuinely empty column — its own placeholder already shows

    const visibleCount = listEl.querySelectorAll(".task-card:not(.is-hidden)").length;
    if (visibleCount === 0) {
      const messageEl = document.createElement("p");
      messageEl.className = "task-list-empty";
      messageEl.setAttribute("data-filter-empty", "true");
      messageEl.textContent = "No matching tasks.";
      listEl.appendChild(messageEl);
    }
  });
}

/* --------------------------------------------------------------------
   8. ADD / EDIT MODAL
   -------------------------------------------------------------------- */

function openAddModal() {
  currentEditId = "";
  taskForm.reset();
  clearFormErrors();

  taskIdInput.value = "";
  taskPriorityInput.value = "medium";

  taskModalTitle.textContent = "Add task";
  taskModalSubmitBtn.textContent = "Add task";

  showModal(taskModalOverlay);
  taskTitleInput.focus();
}

function openEditModal(id) {
  const task = tasks.find(function (t) {
    return t.id === id;
  });
  if (!task) return;

  currentEditId = id;
  clearFormErrors();

  taskIdInput.value = task.id;
  taskTitleInput.value = task.title;
  taskDescriptionInput.value = task.description;
  taskAssigneeInput.value = task.assignee || "";
  taskPriorityInput.value = task.priority;
  taskDueDateInput.value = task.dueDate || "";

  taskModalTitle.textContent = "Edit task";
  taskModalSubmitBtn.textContent = "Save changes";

  showModal(taskModalOverlay);
  taskTitleInput.focus();
}

function closeTaskModal() {
  hideModal(taskModalOverlay);
  taskForm.reset();
  clearFormErrors();
  currentEditId = "";
}

function handleTaskFormSubmit(event) {
  event.preventDefault();

  const formData = {
    title: taskTitleInput.value,
    description: taskDescriptionInput.value,
    assignee: taskAssigneeInput.value,
    priority: taskPriorityInput.value,
    dueDate: taskDueDateInput.value
  };

  const validation = validateForm(formData.title, formData.dueDate);
  showFormErrors(validation.errors);
  if (!validation.isValid) return;

  if (currentEditId) {
    editTask(currentEditId, formData);
  } else {
    createTask(formData);
  }

  closeTaskModal();
}

/* --------------------------------------------------------------------
   9. DELETE CONFIRMATION MODAL
   -------------------------------------------------------------------- */

function openDeleteModal(id) {
  const task = tasks.find(function (t) {
    return t.id === id;
  });
  if (!task) return;

  pendingDeleteId = id;
  deleteTaskNameEl.textContent = '"' + task.title + '"';
  showModal(deleteModalOverlay);
}

function closeDeleteModal() {
  hideModal(deleteModalOverlay);
  pendingDeleteId = "";
}

function handleDeleteConfirm() {
  if (pendingDeleteId) {
    deleteTask(pendingDeleteId);
  }
  closeDeleteModal();
}

/* --------------------------------------------------------------------
   10. GENERIC MODAL HELPERS
   -------------------------------------------------------------------- */

function showModal(overlayEl) {
  overlayEl.hidden = false;
}

function hideModal(overlayEl) {
  overlayEl.hidden = true;
}

function isAnyModalOpen() {
  return !taskModalOverlay.hidden || !deleteModalOverlay.hidden;
}

function closeAnyOpenModal() {
  if (!taskModalOverlay.hidden) closeTaskModal();
  if (!deleteModalOverlay.hidden) closeDeleteModal();
}

/* --------------------------------------------------------------------
   10b. DRAG & DROP HANDLERS
   -------------------------------------------------------------------- */

// Fired when the user starts dragging a task card.
function handleDragStart(event) {
  const card = event.target.closest(".task-card");
  if (!card) return;

  draggedTaskId = card.getAttribute("data-task-id");
  card.classList.add("is-dragging");

  // Needed for Firefox, and good practice generally.
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedTaskId);
}

// Fired when a drag ends, whether it dropped successfully or not.
// Cleans up any leftover visual states.
function handleDragEnd(event) {
  const card = event.target.closest(".task-card");
  if (card) card.classList.remove("is-dragging");

  draggedTaskId = "";

  document.querySelectorAll(".column.is-drag-over").forEach(function (col) {
    col.classList.remove("is-drag-over");
  });
}

// Fired continuously while a card is dragged over a column's task list.
// Must call preventDefault() or the browser won't allow a drop there.
function handleDragOver(event) {
  const listEl = event.target.closest(".task-list");
  if (!listEl) return;

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const columnEl = listEl.closest(".column");
  if (columnEl) columnEl.classList.add("is-drag-over");
}

// Fired when the dragged card leaves a column's task list.
// Only removes the highlight once the pointer has actually left the column
// (not just moved between two child elements inside it).
function handleDragLeave(event) {
  const listEl = event.target.closest(".task-list");
  if (!listEl) return;

  const columnEl = listEl.closest(".column");
  if (columnEl && !columnEl.contains(event.relatedTarget)) {
    columnEl.classList.remove("is-drag-over");
  }
}

// Fired when the card is dropped onto a column's task list.
function handleDrop(event) {
  const listEl = event.target.closest(".task-list");
  if (!listEl) return;

  event.preventDefault();

  const columnEl = listEl.closest(".column");
  if (columnEl) columnEl.classList.remove("is-drag-over");

  const newStatus = listEl.getAttribute("data-tasklist");
  const taskId = draggedTaskId || event.dataTransfer.getData("text/plain");

  if (taskId && newStatus) {
    moveTask(taskId, newStatus);
  }
}

/* --------------------------------------------------------------------
   11. EVENT LISTENERS
   -------------------------------------------------------------------- */

// Add task
addTaskBtn.addEventListener("click", openAddModal);

// Close the Add/Edit modal (X button, Cancel button, or clicking the overlay)
taskModalCloseBtn.addEventListener("click", closeTaskModal);
taskModalCancelBtn.addEventListener("click", closeTaskModal);
taskModalOverlay.addEventListener("click", function (event) {
  if (event.target === taskModalOverlay) closeTaskModal();
});

// Submit the Add/Edit form
taskForm.addEventListener("submit", handleTaskFormSubmit);

// Close the delete confirmation (Cancel button or clicking the overlay)
deleteModalCancelBtn.addEventListener("click", closeDeleteModal);
deleteModalOverlay.addEventListener("click", function (event) {
  if (event.target === deleteModalOverlay) closeDeleteModal();
});
deleteModalConfirmBtn.addEventListener("click", handleDeleteConfirm);

// Escape key closes whichever modal is open
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" && isAnyModalOpen()) {
    closeAnyOpenModal();
  }
});

// Event delegation: one listener handles every card's edit/delete button,
// since cards are created dynamically and don't exist at page load.
boardEl.addEventListener("click", function (event) {
  const editBtn = event.target.closest('[data-action="edit"]');
  if (editBtn) {
    const card = editBtn.closest(".task-card");
    if (card) openEditModal(card.getAttribute("data-task-id"));
    return;
  }

  const deleteBtn = event.target.closest('[data-action="delete"]');
  if (deleteBtn) {
    const card = deleteBtn.closest(".task-card");
    if (card) openDeleteModal(card.getAttribute("data-task-id"));
  }
});

// Drag and drop: all five handlers are delegated on the board itself,
// since task cards and columns are re-created dynamically as tasks change.
boardEl.addEventListener("dragstart", handleDragStart);
boardEl.addEventListener("dragend", handleDragEnd);
boardEl.addEventListener("dragover", handleDragOver);
boardEl.addEventListener("dragleave", handleDragLeave);
boardEl.addEventListener("drop", handleDrop);

// Search: filter cards live as the user types.
searchInputEl.addEventListener("input", function (event) {
  searchTasks(event.target.value);
});

// Filter: apply whenever the dropdown selection changes.
filterSelectEl.addEventListener("change", function (event) {
  filterTasks(event.target.value);
});

// Accessibility: a task card is keyboard-focusable (tabindex="0"), so
// pressing Enter or Space while it's focused opens the same Edit modal
// the edit icon would. Only fires when the card itself has focus, not
// when focus is on one of its buttons (they already handle their own Enter).
boardEl.addEventListener("keydown", function (event) {
  const isCard = event.target.classList && event.target.classList.contains("task-card");
  if (isCard && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openEditModal(event.target.getAttribute("data-task-id"));
  }
});

/* --------------------------------------------------------------------
   12. INIT
   -------------------------------------------------------------------- */

function init() {
  tasks = loadTasks();
  saveTasks(); // ensures storage is populated on first run
  renderBoard();

  activities = loadActivity();
  saveActivity(); // ensures storage is populated on first run
  renderActivity();
}

init();
