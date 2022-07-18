#!/usr/bin/node

import { db, sql, tables } from "./database.js";
import { computeCached, saveResult } from "./utils.js";
import { findProfileByName, findProfileByUuid } from "./yggdrasil-api.js";
import { SingleBar } from "cli-progress";

async function queryUuidNameDuplicates() {
    return await db.query(sql`
        SELECT
            t3.id AS id,
            t3.uuid AS uuid,
            t3.name AS name,
            t2.count AS count
        FROM ${sql.ident(tables.uuid)} t3
        JOIN (
            SELECT
                t1.uuid AS uuid,
                t1.name AS name,
                COUNT(t1.id) AS count
            FROM ${sql.ident(tables.uuid)} t1
            GROUP BY t1.uuid, t1.name
            HAVING count > 1
        ) t2 ON
            t2.uuid = t3.uuid AND
            t2.name = t3.name
        ORDER BY t3.name, t3.id
    `);
}

async function queryUuidConflicts() {
    return await db.query(sql`
        SELECT
            t3.id AS id,
            t3.name AS name,
            t3.uuid AS uuid,
            t2.count AS count,
            t2.unique_count AS unique_count
        FROM ${sql.ident(tables.uuid)} t3
        JOIN (
            SELECT
                t1.name AS name,
                COUNT(t1.id) AS count,
                COUNT(DISTINCT t1.uuid) AS unique_count
            FROM ${sql.ident(tables.uuid)} t1
            GROUP BY t1.name
            HAVING count > 1
        ) t2 ON
            t2.name = t3.name
        ORDER BY t3.name, t3.id
    `);
}

async function queryNameConflicts() {
    return await db.query(sql`
        SELECT
            t3.id AS id,
            t3.uuid AS uuid,
            t3.name AS name,
            t2.count AS count,
            t2.unique_count AS unique_count
        FROM ${sql.ident(tables.uuid)} t3
        JOIN (
            SELECT
                t1.uuid AS uuid,
                COUNT(t1.id) AS count,
                COUNT(DISTINCT t1.name) AS unique_count
            FROM ${sql.ident(tables.uuid)} t1
            GROUP BY t1.uuid
            HAVING count > 1
        ) t2 ON
            t2.uuid = t3.uuid
        ORDER BY t3.uuid, t3.id
    `);
}

async function queryDanglingUuids() {
    return await db.query(sql`
        SELECT id, uuid, name FROM ${sql.ident(tables.uuid)}
        WHERE name NOT IN (
           SELECT name FROM ${sql.ident(tables.players)}
        )
    `);
}

async function queryCaseInconsistentNames() {
    return await db.query(sql`
        SELECT
            t1.name AS name1,
            t2.name AS name2
        FROM (
            SELECT DISTINCT(name) AS name FROM ${sql.ident(tables.players)}
        ) t1
        JOIN (
            SELECT DISTINCT(name) AS name FROM ${sql.ident(tables.uuid)}
        ) t2
        ON
            t1.name = t2.name AND
            t1.name <> CAST(t2.name AS BINARY)
    `);
}

function getAffectedUuidsAndNames(...resultSets) {
    const uuids = new Set();
    const names = new Set();
    for (const resultSet of resultSets) {
        for (const record of resultSet) {
            uuids.add(record.uuid);
            names.add(record.name);
        }
    }
    return {
        affectedUuids: Array.from(uuids).sort(),
        affectedNames: Array.from(names).sort()
    };
}

function checkOverlap(uuidConflicts, nameConflicts) {
    const uuids = new Set();
    const names = new Set();
    for (const record of uuidConflicts) {
        if (record.unique_count > 1) {
            uuids.add(record.uuid);
            names.add(record.name);
        }
    }

    const overlappedUuids = new Set();
    const overlappedNames = new Set();
    for (const record of nameConflicts) {
        if (record.unique_count > 1) {
            if (uuids.has(record.uuid)) {
                overlappedUuids.add(record.uuid);
            }
            if (names.has(record.name)) {
                overlappedNames.add(record.name);
            }
        }
    }
    return {
        overlappedUuids: Array.from(overlappedUuids).sort(),
        overlappedNames: Array.from(overlappedNames).sort()
    };
}

(async () => {
    const duplicates = await computeCached("duplicates.json", queryUuidNameDuplicates);
    console.info(`${duplicates.length} duplicates found`);

    const uuidConflicts = await computeCached("uuid_conflicts.json", queryUuidConflicts);
    console.info(`${uuidConflicts.length} uuid conflicts found`);

    const nameConflicts = await computeCached("name_conflicts.json", queryNameConflicts);
    console.info(`${nameConflicts.length} name conflicts found`);

    const { affectedUuids, affectedNames } = await computeCached("affected_uuids_names.json",
        async () => getAffectedUuidsAndNames(duplicates, uuidConflicts, nameConflicts));
    console.info(`${affectedUuids.length} uuids affected, ${affectedNames.length} names affected`);

    const danglingUuids = await computeCached("dangling_uuids.json", queryDanglingUuids);
    console.info(`${danglingUuids.length} dangling uuids found`);

    const caseInconsistentNames = await computeCached("case_inconsistent_names.json", queryCaseInconsistentNames);
    console.info(`${caseInconsistentNames.length} names are case-inconsistent`);

    const { overlappedUuids, overlappedNames } = checkOverlap(uuidConflicts, nameConflicts);
    if (overlappedUuids.length > 0 || overlappedNames > 0) {
        console.error("Conflict uuids & conflict names are overlapped!");
        console.error("Overlapped uuids: ", overlappedUuids);
        console.error("Overlapped names: ", overlappedNames);
        throw new Error();
    } else {
        console.info("No overlapping detected");
    }

    const uuid2profile = await computeCached("uuid2profile.json",
        async () => {
            console.info("Fetching profiles by uuid...");
            const bar = new SingleBar();
            bar.start(affectedUuids.length);
            const result = {};
            for (const uuid of affectedUuids) {
                result[uuid] = await findProfileByUuid(uuid);
                bar.increment();
            }
            bar.stop();
            return result;
        });

    const name2profile = await computeCached("name2profile.json",
        async () => {
            console.info("Fetching profiles by name...");
            const bar = new SingleBar();
            bar.start(affectedNames.length);
            const result = {};
            for (const name of affectedNames) {
                result[name] = await findProfileByName(name);
                bar.increment();
            }
            bar.stop();
            return result;
        });

    console.info("Checking dangling names...");
    const danglingNamesSet = new Set();
    for (const record of danglingUuids) {
        const profile = name2profile[record.name];
        if (profile !== undefined && profile !== null) {
            console.error(`Dandling name [${record.name}] has profile: `, name2profile[record.name]);
            throw new Error();
        }
        danglingNamesSet.add(record.name);
    }
    for (const [name, profile] of Object.entries(name2profile)) {
        if ((profile === null) != (danglingNamesSet.has(name))) {
            console.error("Profile existence is inconsistent: ", name, profile);
            throw new Error();
        }
    }

    const idsToDelete = new Set();
    uuidConflicts.forEach(record => idsToDelete.add(record.id));
    nameConflicts.forEach(record => idsToDelete.add(record.id));

    console.info("Checking name conflicts...");
    const uuid2record = new Map();
    for (const record of nameConflicts) {
        if (uuid2record.has(record.uuid)) {
            const existent = uuid2record.get(record.uuid);
            if (record.id < existent.id) {
                uuid2record.set(record.uuid, record);
            }
        } else {
            uuid2record.set(record.uuid, record);
        }
    }
    for (const record of uuid2record.values()) {
        idsToDelete.delete(record.id);
        if (danglingNamesSet.has(record.name)) {
            if (uuid2profile[record.uuid] !== null) {
                console.error(`Expect uuid [${record.uuid}] to have no profile, actual: `, uuid2profile[record.uuid]);
                throw new Error();
            }
        } else {
            const expected = record.name;
            const actual = uuid2profile[record.uuid].name;
            if (expected.toLowerCase() !== actual.toLowerCase()) { // ignore case
                console.error(`Expect uuid [${record.uuid}] to have name [${expected}], actual: [${actual}]`);
                throw new Error();
            }
        }
    }

    console.info("Checking uuid conflicts...");
    const name2record = new Map();
    for (const record of uuidConflicts) {
        if (name2record.has(record.name)) {
            const existent = name2record.get(record.name);
            if (record.id < existent.id) {
                name2record.set(record.name, record);
            }
        } else {
            name2record.set(record.name, record);
        }
    }
    for (const [name, record] of name2record.entries()) {
        idsToDelete.delete(record.id);
        if (danglingNamesSet.has(name)) {
            if (name2profile[name] !== null) {
                console.error(`Expect name [${name}] to have no profile, actual: `, name2profile[name]);
                throw new Error();
            }
        } else {
            const expected = record.uuid;
            const actual = name2profile[name].uuid;
            if (expected !== actual) {
                console.error(`Expect name [${name}] to have uuid [${expected}], actual: [${actual}]`);
                throw new Error();
            }
        }
    }

    console.info(`Expect to delete ${idsToDelete.size} inconsistent rows`);
    saveResult("ids_to_delete.json", Array.from(idsToDelete).sort());

    console.info("Ready for migration!");

    await db.dispose();
})();
