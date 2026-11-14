(function ()
{
    'use strict';

    // ---------------------------------------------------------------- config

    const STORAGE_KEY = "timeAutomation.settings";

    // Times are 24-hour ("14:00" = 2:00 PM), which is what <input type="time"> uses.
    const DEFAULTS = {
        morning:   { start: "06:30", end: "08:45", status: "I" },
        afternoon: { start: "14:00", end: "16:30", status: "I" }
    };

    const STATUS_OPTIONS = {
        I: "I - In",
        L: "L - Lunch",
        B: "B - Break",
        W: "W - Work Out of Office",
        X: "X - Not Working"
    };

    const IDS = {
        editButton: "btnEdit",
        addTimeTransaction: "btnAdd",
        morning:   { start: "StartTime-0-", end: "EndTime-0-", status: "Status-0-" },
        afternoon: { start: "StartTime-1-", end: "EndTime-1-", status: "Status-1-" }
    };

    // ------------------------------------------------------------- utilities

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /** Resolves with the element once it exists, or rejects after `timeoutMs`. */
    function getElement(id, timeoutMs = 10000)
    {
        return new Promise((resolve, reject) =>
        {
            const found = document.getElementById(id);
            if (found)
            {
                resolve(found);
                return;
            }

            const observer = new MutationObserver(() =>
            {
                const el = document.getElementById(id);
                if (el)
                {
                    cleanup();
                    resolve(el);
                }
            });

            const timer = setTimeout(() =>
            {
                cleanup();
                reject(new Error(`Timed out while searching for ${id}`));
            }, timeoutMs);

            function cleanup()
            {
                observer.disconnect();
                clearTimeout(timer);
            }

            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    /** "14:30" -> "02:30 PM" (the zero-padded format the time picker expects). */
    function to12Hour(time24)
    {
        const [h, m] = time24.split(":").map(Number);
        const amPm = h >= 12 ? "PM" : "AM";
        const hour = (h % 12) || 12;
        return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")} ${amPm}`;
    }

    // ------------------------------------------------------- page automation

    async function setStatus(id, value, waitMs = 300)
    {
        const select = await getElement(id);

        if (![...select.options].some((o) => o.value === value))
        {
            throw new Error(`Option not found: ${value}`);
        }

        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(select, value);

        select.dispatchEvent(new Event("input",  { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));

        // Let the page and the combo box widget react before the next step
        await sleep(waitMs);
    }

    async function setTimePicker(id, time24)
    {
        const host = await getElement(id);
        const input = host.querySelector("input.timePicker");
        if (!input) throw new Error(`Time picker input not found in ${id}`);

        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;

        setter.call(input, to12Hour(time24));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(150);                       // let the picker's internal host change fire

        host.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(150);

        // Focus/blur for the form-level listeners, without opening the modal
        host.setAttribute("data-suppress-focus", "true");
        input.focus();
        await sleep(100);
        host.removeAttribute("data-suppress-focus");
        input.blur();
        await sleep(100);

        host.closeModal?.();                    // safety net
        input.blur();                           // closeModal refocuses the input
        await sleep(200);
    }

    async function clickSave(waitMs = 500)
    {
        // Newest footer first: the topmost modal is usually last in the DOM
        const footers = [...document.querySelectorAll(".modalContentFooter")].reverse();

        for (const footer of footers)
        {
            const button = [...footer.querySelectorAll("button.modalContentFooter__button")]
                .find((b) => b.textContent.trim() === "Save");

            if (!button) continue;
            if (button.disabled) throw new Error("Save button is disabled");

            button.click();
            await sleep(waitMs);
            return;
        }

        throw new Error("Save button not found");
    }

    async function run(settings, log)
    {
        log("Opening edit...");
        (await getElement(IDS.editButton)).click();

        log("Setting morning times...");
        await setTimePicker(IDS.morning.start, settings.morning.start);
        await setTimePicker(IDS.morning.end, settings.morning.end);

        log("Adding transaction...");
        (await getElement(IDS.addTimeTransaction)).click();

        log("Setting afternoon times...");
        await setTimePicker(IDS.afternoon.start, settings.afternoon.start);
        await setTimePicker(IDS.afternoon.end, settings.afternoon.end);

        log("Setting statuses...");
        await setStatus(IDS.morning.status, settings.morning.status);
        await setStatus(IDS.afternoon.status, settings.afternoon.status);

        log("Saving...");
        await clickSave();
    }

    // -------------------------------------------------------------------- UI

    function loadSettings()
    {
        try
        {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            if (saved)
            {
                return {
                    morning:   { ...DEFAULTS.morning,   ...saved.morning },
                    afternoon: { ...DEFAULTS.afternoon, ...saved.afternoon }
                };
            }
        }
        catch { /* fall through to defaults */ }

        return structuredClone(DEFAULTS);
    }

    function saveSettings(settings)
    {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
        catch { /* storage unavailable, not critical */ }
    }

    function h(tag, props = {}, ...children)
    {
        const node = document.createElement(tag);
        const { style, ...rest } = props;
        Object.assign(node, rest);
        if (style) Object.assign(node.style, style);
        node.append(...children);
        return node;
    }

    function buildPanel()
    {
        const settings = loadSettings();
        const fieldStyle = { padding: "4px", fontSize: "14px", width: "100%", boxSizing: "border-box" };

        const timeInput = (value) => h("input", { type: "time", value, style: fieldStyle });
        const statusSelect = (value) =>
        {
            const select = h("select", { style: fieldStyle });
            for (const [code, label] of Object.entries(STATUS_OPTIONS))
            {
                select.append(h("option", { value: code, textContent: label }));
            }
            select.value = value;
            return select;
        };

        const fields = {
            morning:   { start: timeInput(settings.morning.start),   end: timeInput(settings.morning.end),   status: statusSelect(settings.morning.status) },
            afternoon: { start: timeInput(settings.afternoon.start), end: timeInput(settings.afternoon.end), status: statusSelect(settings.afternoon.status) }
        };

        const cell = (child, bold = false) => h("div", { style: { fontWeight: bold ? "bold" : "normal" } }, child);

        const grid = h("div", {
            style: { display: "grid", gridTemplateColumns: "auto 1fr 1fr 1.6fr", gap: "6px 8px", alignItems: "center" }
        },
            cell(""), cell("Start", true), cell("End", true), cell("Status", true),
            cell("Morning", true),   fields.morning.start,   fields.morning.end,   fields.morning.status,
            cell("Afternoon", true), fields.afternoon.start, fields.afternoon.end, fields.afternoon.status
        );

        const statusLine = h("div", { style: { fontSize: "13px", minHeight: "1.2em", marginTop: "8px" } });
        const log = (msg, isError = false) =>
        {
            statusLine.textContent = msg;
            statusLine.style.color = isError ? "#b91c1c" : "#374151";
            console.log(msg);
        };

        const startButton = h("button", {
            textContent: "Start Automation",
            style: {
                marginTop: "10px", width: "100%", padding: "12px", fontSize: "16px", fontWeight: "bold",
                backgroundColor: "#2563eb", color: "#fff", border: "2px solid #1e40af",
                borderRadius: "8px", cursor: "pointer"
            }
        });

        const readSettings = () => ({
            morning:   { start: fields.morning.start.value,   end: fields.morning.end.value,   status: fields.morning.status.value },
            afternoon: { start: fields.afternoon.start.value, end: fields.afternoon.end.value, status: fields.afternoon.status.value }
        });

        startButton.addEventListener("click", async () =>
        {
            const current = readSettings();
            const missing = [current.morning, current.afternoon].some((r) => !r.start || !r.end);
            if (missing)
            {
                log("Fill in all four times first.", true);
                return;
            }

            saveSettings(current);
            startButton.disabled = true;

            try
            {
                await run(current, log);
                log("Done.");
            }
            catch (err)
            {
                log(`Failed: ${err.message ?? err}`, true);
                console.error(err);
            }
            finally
            {
                startButton.disabled = false;
            }
        });

        return h("div", {
            style: {
                position: "fixed", top: "20px", right: "20px", zIndex: "999999",
                width: "420px", padding: "14px", backgroundColor: "#fff", color: "#111",
                border: "3px solid #1e40af", borderRadius: "12px",
                boxShadow: "0 4px 10px rgba(0, 0, 0, 0.3)", fontFamily: "sans-serif"
            }
        }, grid, startButton, statusLine);
    }

    console.log("Script Activated...");
    document.body.appendChild(buildPanel());
})();