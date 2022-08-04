#!/usr/bin/node

import { db, sql, tables } from "./database.js";
import { loadResult } from "./utils.js";

function arrayEquals(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

(async () => {
    const expectDeletions = await loadResult("ids_to_delete.json");
    if (expectDeletions === null) {
        console.error("Please run precheck.js first!");
        throw new Error();
    }

    console.info("Creating new table...");
    await db.query(sql`
            DROP TABLE IF EXISTS ${sql.ident(tables.uuid_new)};

            CREATE TABLE ${sql.ident(tables.uuid_new)}
            LIKE ${sql.ident(tables.uuid)};

            INSERT ${sql.ident(tables.uuid_new)}
            SELECT * FROM ${sql.ident(tables.uuid)};
        `
    );

    console.info("Deleting inconsistent rows...");
    await db.query(sql`
            DROP TABLE IF EXISTS tmp_to_delete;

            CREATE TEMPORARY TABLE tmp_to_delete
            SELECT id FROM ${sql.ident(tables.uuid_new)} t1
            JOIN (
                SELECT uuid, name, MIN(id) AS min_id FROM ${sql.ident(tables.uuid_new)}
                GROUP BY uuid, name
                HAVING COUNT(id) > 1
            ) t2 ON t1.uuid = t2.uuid AND t1.name = t2.name AND t1.id <> t2.min_id;

            INSERT INTO tmp_to_delete
            SELECT id FROM ${sql.ident(tables.uuid_new)} t1
            JOIN (
                SELECT name, MIN(id) AS min_id FROM ${sql.ident(tables.uuid_new)}
                GROUP BY name
                HAVING COUNT(DISTINCT uuid) > 1
            ) t2 ON t1.name = t2.name AND t1.id <> t2.min_id;

            INSERT INTO tmp_to_delete
            SELECT id FROM ${sql.ident(tables.uuid_new)} t1
            JOIN (
                SELECT uuid, MIN(id) AS min_id FROM ${sql.ident(tables.uuid_new)}
                GROUP BY uuid
                HAVING COUNT(DISTINCT name) > 1
            ) t2 ON t1.uuid = t2.uuid AND t1.id <> t2.min_id;

            DELETE FROM ${sql.ident(tables.uuid_new)} WHERE id IN (
                SELECT id FROM tmp_to_delete
            );

            DROP TABLE tmp_to_delete;
        `
    );

    console.info("Verifying...");
    const deletedIds = (await db.query(sql`
        SELECT id FROM ${sql.ident(tables.uuid)}
        WHERE id NOT IN (
            SELECT id FROM ${sql.ident(tables.uuid_new)}
        )
    `)).map(it => it.id);
    expectDeletions.sort();
    deletedIds.sort();
    if (!arrayEquals(expectDeletions, deletedIds)) {
        console.error("Actual deleted rows are not the same as expected!");
        throw new Error();
    }

    console.info("Adding unique constraints...");
    await db.query(sql`
        ALTER TABLE ${sql.ident(tables.uuid_new)} ADD CONSTRAINT UNIQUE (uuid);
        ALTER TABLE ${sql.ident(tables.uuid_new)} ADD CONSTRAINT UNIQUE (name);
    `);

    console.info("Swapping tables...");
    await db.query(sql`
        RENAME TABLE
            ${sql.ident(tables.uuid)} TO ${sql.ident(tables.uuid_old)},
            ${sql.ident(tables.uuid_new)} TO ${sql.ident(tables.uuid)};
    `);

    console.info("Migration done!");

    await db.dispose();
})();
