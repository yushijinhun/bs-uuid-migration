import { readFile, writeFile, mkdir } from "fs/promises";

const resultsDir = "results";

export async function saveResult(filename, object) {
    const path = `${resultsDir}/${filename}`;
    await mkdir(resultsDir, { recursive: true });
    await writeFile(path, JSON.stringify(object), { encoding: "utf-8" });
    console.info(`Saved to ${path}`);
}

export async function loadResult(filename) {
    const path = `${resultsDir}/${filename}`;
    try {
        const content = await readFile(path, { encoding: "utf-8" });
        console.info(`Loaded cache from ${path}`);
        return JSON.parse(content);
    } catch (error) {
        if (error.code === "ENOENT") {
            return null;
        } else {
            throw error;
        }
    }
}

export async function computeCached(filename, fn) {
    const cached = await loadResult(filename);
    if (cached !== null) {
        return cached;
    }
    const computed = await fn();
    await saveResult(filename, computed);
    return computed;
}
