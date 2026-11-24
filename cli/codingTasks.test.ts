import assert from "node:assert/strict";
import test from "node:test";
import { createCodingTasks } from "./codingTasks.ts";

test("task plans are isolated and reject invalid or cyclic batches atomically", (): void => {
  const { dispatch } = createCodingTasks();
  assert.equal(dispatch({ name: "project" }), undefined);
  assert.deepEqual(dispatch({ name: "task_list" }), { tasks: [], revision: 0 });
  assert.ok("error" in dispatch({
    name: "task_plan",
    tasks: [{ id: "a", title: "A", dependsOn: ["b"] }, { id: "b", title: "B", dependsOn: ["a"] }],
  })!);
  assert.deepEqual(dispatch({ name: "task_list" }), { tasks: [], revision: 0 });
  assert.ok("tasks" in dispatch({ name: "task_plan", tasks: [{ id: "a", title: "A" }] })!);
  assert.ok("error" in dispatch({
    name: "task_plan", tasks: [{ id: "b", title: "B" }, { id: "a", title: "duplicate" }],
  })!);
  assert.deepEqual(dispatch({ name: "task_list" }), {
    revision: 1, tasks: [{ id: "a", title: "A", dependsOn: [], status: "pending" }],
  });
  assert.deepEqual(createCodingTasks().dispatch({ name: "task_list" }), { tasks: [], revision: 0 });
});

test("task updates enforce dependencies, transition and optional revision", (): void => {
  const { dispatch } = createCodingTasks();
  dispatch({ name: "task_plan", tasks: [{ id: "b", title: "B", dependsOn: ["a"] }, { id: "a", title: "A" }] });
  assert.ok("error" in dispatch({ name: "task_update", id: "b", status: "in_progress" })!);
  assert.ok("error" in dispatch({ name: "task_update", id: "a", status: "completed" })!);
  assert.ok("tasks" in dispatch({ name: "task_update", id: "a", status: "in_progress", revision: 1 })!);
  assert.ok("error" in dispatch({ name: "task_update", id: "a", status: "completed", revision: 1 })!);
  assert.ok("tasks" in dispatch({ name: "task_update", id: "a", status: "completed", revision: 2 })!);
  assert.ok("tasks" in dispatch({ name: "task_update", id: "b", status: "in_progress", revision: 3 })!);
  assert.ok("error" in dispatch({ name: "task_update", id: "a", status: "pending" })!);
  assert.deepEqual(dispatch({ name: "task_list" }), {
    revision: 4,
    tasks: [
      { id: "b", title: "B", dependsOn: ["a"], status: "in_progress", notes: undefined },
      { id: "a", title: "A", dependsOn: [], status: "completed", notes: undefined },
    ],
  });
});
