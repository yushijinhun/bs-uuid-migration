# bs-uuid-migration
A tool to fix data inconsistency problems described in [blessing-skin-plugins#151](https://github.com/bs-community/blessing-skin-plugins/issues/151).

**Only MySQL is supported!**

## Usage
1. Clone the repository

    ```bash
    git clone https://github.com/yushijinhun/bs-uuid-migration.git
    cd bs-uuid-migration
    ```

2. Install dependencies (Node.js is required)

    ```bash
    npm install
    ```

3. Copy `config.js.example` to `config.js`

    ```bash
    cp config.js.example config.js
    ```

4. Edit `config.js` to fill in the database URL, the site URL and the table prefix

5. **Block users' access to the website**

    User operations during the migration might corrupt the data, 
    so you have to block access from other machines (eg. using iptables).
    The migration script needs to collect some data from the website API for integrity check,
    please make sure the machine running the script can still access the website.

6. Run the precheck script

    ```bash
    npm run precheck
    ```

    This command collects data and checks whether it's safe to perform migration.
    The collected data are saved in `results/` and cached.

7. Run the migration script

    ```bash
    npm run migrate
    ```

    This command performs the migration.
    The migration will remove inconsistent records and add constraints to the table.
    The migrated data will be temporarily stored in the table `<prefix>_uuid_new`.
    After data is verified, `<prefix>_uuid` will be renamed to `<prefix>_uuid_old`,
    and `<prefix>_uuid_new` will be renamed to `<prefix>_uuid`.
