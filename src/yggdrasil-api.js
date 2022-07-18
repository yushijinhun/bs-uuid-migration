import config from "../config.js";
import axios from "axios";

const apiRoot = config.site + "/api/yggdrasil";

export async function findProfileByUuid(uuid) {
    const response = await axios.get(`${apiRoot}/sessionserver/session/minecraft/profile/${uuid}?unsigned=true`);
    if (response.status === 204) {
        return null;
    } else {
        return {
            uuid: response.data.id,
            name: response.data.name
        };
    }
}

export async function findProfileByName(name) {
    const response = await axios.post(`${apiRoot}/api/profiles/minecraft`, [name]);
    if (response.data.length === 0) {
        return null;
    } else if (response.data.length === 1) {
        return {
            uuid: response.data[0].id,
            name: response.data[0].name
        };
    } else {
        throw new Error("Multiple results are returned");
    }
}
