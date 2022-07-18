import createConnectionPool from "@databases/mysql";
import config from "../config.js";

export const db = createConnectionPool(config.database);
export const tables = {
    uuid: config.tablePrefix + "uuid",
    players: config.tablePrefix + "players",
    uuid_new: config.tablePrefix + "uuid_new",
    uuid_old: config.tablePrefix + "uuid_old"
};
export { sql } from "@databases/mysql";
