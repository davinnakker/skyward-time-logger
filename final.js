// ==UserScript==
// @name         SafeAuto
// @namespace    http://tampermonkey.net/
// @version      2026-11-14
// @description  try to take over the world!
// @author       You
// @match        https://skyward.iscorp.com/MadisonSD321IDBus/TimeTracking/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==


(function ()
{
    'use strict';

    // ---------------------------------------------------------------- config

    const STORAGE_KEY = "timeAutomation.settings";

    // 24-hour times ("14:00" = 2:00 PM), matching <input type="time">.
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
        addTimeTransaction: "btnAdd"
    };

    const ROWS = {
        morning:   { start: "StartTime-0-", end: "EndTime-0-", status: "Status-0-", duration: "DurationProxy-0-" },
        afternoon: { start: "StartTime-1-", end: "EndTime-1-", status: "Status-1-", duration: "DurationProxy-1-" }
    };

    // Wait for the page to recompute each row's duration and check it matches end - start.
    // Turn off if the duration field is not per-row or is formatted unexpectedly.
    const VERIFY_DURATION = true;

    // Upper bounds only. A timeout means "something is wrong, stop with an error";
    // it is never how the script waits for things to happen.
    const LIMITS = { elementMs: 10000, eventMs: 5000, valueMs: 5000, networkMs: 8000 };

    // ------------------------------------------------- event-driven primitives

    /** Yields to the event loop: runs after all pending microtasks (Vue's nextTick, promise chains). */
    function macrotask()
    {
        return new Promise((resolve) =>
        {
            const channel = new MessageChannel();
            channel.port1.onmessage = () =>
            {
                channel.port1.close();
                resolve();
            };
            channel.port2.postMessage(null);
        });
    }

    /**
     * Resolves with the predicate's truthy result as soon as the DOM changes in a way
     * that satisfies it. Driven by MutationObserver, so there is no polling.
     */
    function waitUntil(predicate, { root = document.body, attributeFilter, timeoutMs = LIMITS.elementMs, what = "condition" } = {})
    {
        return new Promise((resolve, reject) =>
        {
            const initial = predicate();
            if (initial)
            {
                resolve(initial);
                return;
            }

            const observer = new MutationObserver(() =>
            {
                const result = predicate();
                if (result)
                {
                    finish();
                    resolve(result);
                }
            });

            const timer = setTimeout(() =>
            {
                finish();
                reject(new Error(`Timed out waiting for ${what}`));
            }, timeoutMs);

            function finish()
            {
                observer.disconnect();
                clearTimeout(timer);
            }

            observer.observe(root, {
                childList: true,
                subtree: true,
                ...(attributeFilter ? { attributes: true, attributeFilter } : {})
            });
        });
    }

    const byId = (id) => waitUntil(() => document.getElementById(id), { what: `element #${id}` });

    /** Resolves on the next matching event. Call it BEFORE triggering the action so the event can't be missed. */
    function nextEvent(target, type, { filter = () => true, timeoutMs = LIMITS.eventMs, what = type } = {})
    {
        return new Promise((resolve, reject) =>
        {
            const onEvent = (event) =>
            {
                if (!filter(event)) return;
                cleanup();
                resolve(event);
            };

            const timer = setTimeout(() =>
            {
                cleanup();
                reject(new Error(`Timed out waiting for ${what}`));
            }, timeoutMs);

            function cleanup()
            {
                target.removeEventListener(type, onEvent);
                clearTimeout(timer);
            }

            target.addEventListener(type, onEvent);
        });
    }

    // Programmatic `.value = x` fires no event, so intercept the setter on this one element instead.
    const valueSubscribers = new WeakMap();

    function subscribeToValue(element, callback)
    {
        if (!valueSubscribers.has(element))
        {
            const subscribers = new Set();
            valueSubscribers.set(element, subscribers);

            const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
            Object.defineProperty(element, "value", {
                configurable: true,
                get() { return native.get.call(this); },
                set(newValue)
                {
                    native.set.call(this, newValue);
                    subscribers.forEach((fn) => fn());
                }
            });
        }

        valueSubscribers.get(element).add(callback);
        return () => valueSubscribers.get(element).delete(callback);
    }

    /** Resolves as soon as `predicate(element.value)` is true, checking now and on every value change. */
    function waitForValue(element, predicate, { timeoutMs = LIMITS.valueMs, what = "value" } = {})
    {
        return new Promise((resolve, reject) =>
        {
            if (predicate(element.value))
            {
                resolve(element.value);
                return;
            }

            const check = () =>
            {
                if (predicate(element.value))
                {
                    cleanup();
                    resolve(element.value);
                }
            };

            const unsubscribe = subscribeToValue(element, check);
            element.addEventListener("input", check);
            element.addEventListener("change", check);

            const timer = setTimeout(() =>
            {
                cleanup();
                reject(new Error(`Timed out waiting for ${what} (last value: "${element.value}")`));
            }, timeoutMs);

            function cleanup()
            {
                unsubscribe();
                element.removeEventListener("input", check);
                element.removeEventListener("change", check);
                clearTimeout(timer);
            }
        });
    }

    // Counts in-flight XHR/fetch requests and notifies when they all finish.
    const network = (() =>
    {
        let inFlight = 0;
        const waiters = new Set();

        const finished = () =>
        {
            inFlight = Math.max(0, inFlight - 1);
            if (inFlight === 0)
            {
                waiters.forEach((resolve) => resolve(true));
                waiters.clear();
            }
        };

        const nativeSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (...args)
        {
            inFlight++;
            this.addEventListener("loadend", finished, { once: true });   // fires for success, error, abort, timeout
            try
            {
                return nativeSend.apply(this, args);
            }
            catch (error)
            {
                this.removeEventListener("loadend", finished);
                finished();
                throw error;
            }
        };

        const nativeFetch = window.fetch;
        window.fetch = function (...args)
        {
            inFlight++;
            return nativeFetch.apply(this, args).finally(finished);
        };

        /** Best effort: resolves false (and warns) if unrelated long-lived requests keep it busy. */
        function idle(timeoutMs = LIMITS.networkMs)
        {
            if (inFlight === 0) return Promise.resolve(true);

            return new Promise((resolve) =>
            {
                const timer = setTimeout(() =>
                {
                    waiters.delete(done);
                    console.warn("Network did not go idle in time; continuing.");
                    resolve(false);
                }, timeoutMs);

                const done = (value) =>
                {
                    clearTimeout(timer);
                    resolve(value);
                };

                waiters.add(done);
            });
        }

        return { idle };
    })();

    /** Let the page finish reacting to what we just did: pending microtasks, then requests, then re-render. */
    async function settle()
    {
        await macrotask();
        await network.idle();
        await macrotask();
    }

    // ------------------------------------------------------------ conversions

    /** "14:30" -> "02:30 PM" (the zero-padded format the time picker uses). */
    function to12Hour(time24)
    {
        const [h, m] = time24.split(":").map(Number);
        const amPm = h >= 12 ? "PM" : "AM";
        const hour = (h % 12) || 12;
        return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")} ${amPm}`;
    }

    function toMinutes(time24)
    {
        const [h, m] = time24.split(":").map(Number);
        return h * 60 + m;
    }

    /** Parses "H:MM" or "HH:MM" into minutes; NaN when it isn't a duration. */
    function parseDuration(text)
    {
        const match = /^\s*(\d+):(\d{2})\s*$/.exec(text ?? "");
        return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
    }

    // ------------------------------------------------------- page automation

    async function setStatus(id, value)
    {
        const select = await byId(id);

        if (![...select.options].some((o) => o.value === value))
        {
            throw new Error(`Option "${value}" not found in ${id}`);
        }

        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(select, value);

        // dispatchEvent runs every listener synchronously, so the page has already handled these on return
        select.dispatchEvent(new Event("input",  { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));

        await settle();

        if (select.value !== value)
        {
            throw new Error(`${id} reverted to "${select.value}" after being set to "${value}"`);
        }
    }

    async function setTimePicker(id, time24)
    {
        const host = await byId(id);
        const input = await waitUntil(() => host.querySelector("input.timePicker"),
            { root: host, what: `the input inside #${id}` });

        const expected = to12Hour(time24);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;

        // The picker fires an internal `change` on the host once its state has committed.
        // Subscribe first, then trigger, so it can't be missed.
        const committed = nextEvent(host, "change", {
            filter: (event) => event.detail?.internal === true,
            what: `#${id} to commit`
        });

        setter.call(input, expected);
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await committed;

        if (!host.isConnected) throw new Error(`#${id} was removed from the page while being set`);
        if (host.value !== expected) throw new Error(`#${id} holds "${host.value}", expected "${expected}"`);

        // The page's own listeners react to a plain host change and to real focus movement
        host.dispatchEvent(new Event("change", { bubbles: true }));

        host.setAttribute("data-suppress-focus", "true");   // focus without opening the picker modal
        try
        {
            input.focus();
        }
        finally
        {
            host.removeAttribute("data-suppress-focus");
        }
        input.blur();

        await macrotask();                                   // let Vue render aria-expanded

        if (input.getAttribute("aria-expanded") === "true")
        {
            await host.closeModal?.();                       // returns a promise; it refocuses the input
            input.blur();
        }

        await settle();
    }

    async function setRowTimes(row, values)
    {
        await setTimePicker(row.start, values.start);
        await setTimePicker(row.end, values.end);
        await expectDuration(row, values);
    }

    async function expectDuration(row, values)
    {
        if (!VERIFY_DURATION) return;

        const expected = toMinutes(values.end) - toMinutes(values.start);
        const duration = await byId(row.duration);

        await waitForValue(duration, (text) => parseDuration(text) === expected,
            { what: `#${row.duration} to become ${expected} minutes` });
    }

    /** Final gate before saving: everything we set must still be what we set. */
    async function verifyRow(row, values)
    {
        const checks = [
            [row.start, to12Hour(values.start)],
            [row.end, to12Hour(values.end)]
        ];

        for (const [id, expected] of checks)
        {
            const host = await byId(id);
            if (host.value !== expected) throw new Error(`#${id} holds "${host.value}", expected "${expected}"`);
        }

        const status = await byId(row.status);
        if (status.value !== values.status) throw new Error(`#${row.status} holds "${status.value}", expected "${values.status}"`);

        await expectDuration(row, values);
    }

    function findSaveButton()
    {
        // Newest footer first: the topmost modal is usually last in the DOM
        const footers = [...document.querySelectorAll(".modalContentFooter")].reverse();

        for (const footer of footers)
        {
            const button = [...footer.querySelectorAll("button.modalContentFooter__button")]
                .find((b) => b.textContent.trim() === "Save");
            if (button) return button;
        }

        return null;
    }

    async function clickSave()
    {
        const button = await waitUntil(
            () =>
            {
                const candidate = findSaveButton();
                return candidate && !candidate.disabled ? candidate : null;
            },
            { attributeFilter: ["disabled"], what: "an enabled Save button" });

        button.click();
        await settle();

        // A successful save closes the dialog. If it stays, the page is almost certainly showing a validation error.
        try
        {
            await waitUntil(() => !button.isConnected || button.getClientRects().length === 0,
                { attributeFilter: ["class", "style", "hidden"], what: "the dialog to close" });
        }
        catch
        {
            throw new Error("Save was clicked but the dialog did not close. Check the page for a validation message.");
        }
    }

    async function run(settings, log)
    {
        log("Opening edit...");
        (await byId(IDS.editButton)).click();
        await settle();

        log("Setting morning times...");
        await setRowTimes(ROWS.morning, settings.morning);

        log("Adding transaction...");
        (await byId(IDS.addTimeTransaction)).click();
        await settle();

        log("Setting afternoon times...");
        await setRowTimes(ROWS.afternoon, settings.afternoon);

        log("Setting statuses...");
        await setStatus(ROWS.morning.status, settings.morning.status);
        await setStatus(ROWS.afternoon.status, settings.afternoon.status);

        log("Verifying...");
        await verifyRow(ROWS.morning, settings.morning);
        await verifyRow(ROWS.afternoon, settings.afternoon);

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
        const log = (message, isError = false) =>
        {
            statusLine.textContent = message;
            statusLine.style.color = isError ? "#b91c1c" : "#374151";
            console.log(message);
        };

        const startButton = h("button", {
            textContent: "Fill Time",
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

        function validate(current)
        {
            for (const [name, row] of Object.entries(current))
            {
                if (!row.start || !row.end) return `Fill in both ${name} times.`;
                if (toMinutes(row.end) <= toMinutes(row.start)) return `${name}: end time must be after start time.`;
            }
            return null;
        }

        startButton.addEventListener("click", async () =>
        {
            const current = readSettings();
            const problem = validate(current);
            if (problem)
            {
                log(problem, true);
                return;
            }

            saveSettings(current);
            startButton.disabled = true;

            try
            {
                await run(current, log);
                log("Done.");
            }
            catch (error)
            {
                log(`Failed: ${error.message ?? error}`, true);
                console.error(error);
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