const {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
  rm,
} = require("node:fs/promises");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const { validateCanvas } = require("./src/canvas-model.cjs");
class CanvasStore {
  constructor(directory) {
    this.directory = directory;
    this.queue = Promise.resolve();
    this.deletedBoards = new Set();
  }
  async list() {
    await this.queue;
    await mkdir(this.directory, { recursive: true });
    const canvases = [],
      warnings = [];
    for (const file of await readdir(this.directory)) {
      if (!file.endsWith(".json")) continue;
      try {
        canvases.push(
          validateCanvas(
            JSON.parse(await readFile(join(this.directory, file), "utf8")),
          ),
        );
      } catch {
        warnings.push(`Could not read ${file}; the original file was kept.`);
      }
    }
    return { canvases, warnings };
  }
  pruneChannelBoards(server, boardIds) {
    const next = this.queue.then(async () => {
      const active = new Set(boardIds),
        removed = [];
      for (const id of active) this.deletedBoards.delete(id);
      await mkdir(this.directory, { recursive: true });
      for (const file of await readdir(this.directory)) {
        if (!file.endsWith(".json")) continue;
        let canvas;
        try {
          canvas = validateCanvas(
            JSON.parse(await readFile(join(this.directory, file), "utf8")),
          );
        } catch {
          continue;
        }
        if (
          canvas.type === "board" &&
          canvas.channel?.server === server &&
          !active.has(canvas.id)
        ) {
          this.deletedBoards.add(canvas.id);
          await rm(join(this.directory, file), { force: true });
          removed.push(canvas.id);
        }
      }
      return removed;
    });
    this.queue = next.catch(() => {});
    return next;
  }
  save(value) {
    const next = this.queue.then(async () => {
      const canvas = validateCanvas(value);
      if (this.deletedBoards.has(canvas.id))
        throw new Error("The owning channel was deleted.");
      await mkdir(this.directory, { recursive: true });
      if (canvas.type === "board") {
        for (const item of canvas.content.items.filter(
          (item) => item.kind === "canvas",
        )) {
          const referenced = validateCanvas(
            JSON.parse(
              await readFile(
                join(this.directory, item.canvasId + ".json"),
                "utf8",
              ),
            ),
          );
          if (referenced.type === "board")
            throw new Error("Nested boards are not supported yet.");
        }
      }
      const target = join(this.directory, canvas.id + ".json");
      try {
        const existing = validateCanvas(
          JSON.parse(await readFile(target, "utf8")),
        );
        if (
          existing.channel &&
          JSON.stringify(existing.channel) !== JSON.stringify(canvas.channel)
        )
          throw new Error("A channel board cannot be detached or reassigned.");
        if (existing.revision >= canvas.revision) {
          if (JSON.stringify(existing) === JSON.stringify(canvas))
            return existing;
          throw new Error(
            "This Canvas has a newer or conflicting revision. Reopen it before saving.",
          );
        }
        if (existing.type !== canvas.type)
          throw new Error("A Canvas type cannot change.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const temporary = join(
        this.directory,
        canvas.id + "." + randomUUID() + ".tmp",
      );
      try {
        await writeFile(temporary, JSON.stringify(canvas), { flag: "wx" });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
      return canvas;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
module.exports = { CanvasStore };
