const times = {
    "morningStart": "06:30",
    "morningEnd": "08:45",
    "afternoonStart": "02:00",
    "afternoonEnd": "04:30"
}

const ids = {
    "editButton": "btnEdit",
    "addTimeTransaction": "btnAdd",
    "morningStart": "StartTime-0-",
    "morningEnd": "EndTime-0-",
    "morningStatus": "Status-0-",
    "afternoonStart": "StartTime-1-",
    "afternoonEnd": "EndTime-1-",
    "afternoonStatus": "Status-1-"
}

async function main() {
    const editButton = await getElement(ids.editButton);
    editButton.click();

    console.log("setting time picker...");
    await setTimePicker(ids.morningStart, "03:00 PM");
    await setTimePicker(ids.morningEnd, "04:00 PM");

    const addTimeTransaction = await getElement(ids.addTimeTransaction);
    addTimeTransaction.click();

    await setTimePicker(ids.afternoonStart, "05:00 PM");
    await setTimePicker(ids.afternoonEnd, "06:00 PM");
    
    console.log("setting new status");
    await setStatus(ids.morningStatus, "I");
    await setStatus(ids.afternoonStatus, "I");

    console.log("clicking save...");
    await clickSave();
}

async function clickSave(waitMs = 500)
{
    const footers = [...document.querySelectorAll(".modalContentFooter")];

    // Search the most recently added footer first, since the topmost modal is usually last in the DOM
    for (const footer of footers.reverse())
    {
        const button = [...footer.querySelectorAll("button.modalContentFooter__button")]
            .find(b => b.textContent.trim() === "Save");

        if (!button) continue;
        if (button.disabled) throw new Error("Save button is disabled");

        button.click();
        await new Promise(r => setTimeout(r, waitMs));
        return;
    }

    throw new Error("Save button not found");
}

async function setStatus(id, value, waitMs = 300)
{
    const select = await getElement(id);
    if (!select) throw new Error("status select not found: " + id);

    if (![...select.options].some(o => o.value === value))
    {
        throw new Error("option not found: " + value);
    }

    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);

    select.dispatchEvent(new Event("input",  { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    // Let the page and the combo box widget react before the next step
    await new Promise(r => setTimeout(r, waitMs));

    return select.value;
}

async function setTimeFull(host, text) {
  const input = host.querySelector("input.timePicker");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;

  setter.call(input, text);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));      // let the internal host change fire

  host.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));

  // Focus/blur for the form-level listeners, without opening the modal
  host.setAttribute("data-suppress-focus", "true");
  input.focus();
  await new Promise(r => setTimeout(r, 100));
  host.removeAttribute("data-suppress-focus");     // in case focusin didn't consume it
  input.blur();
  await new Promise(r => setTimeout(r, 100));

  host.closeModal?.();                             // safety net
  input.blur();                                    // closeModal refocuses the input, so blur again
  await new Promise(r => setTimeout(r, 200));
}

async function setTimePicker(id, time) {
    host = await getElement(id);
    await setTimeFull(host, time);
}

function getElement(id) {
    return new Promise((resolve, reject) => {
        const element = document.getElementById(id);
        if (element) {
            resolve(element);
            return;
        }
        const observer = new MutationObserver(() => {
            const element = document.getElementById(id);
            if (element) {
                resolve(element);
                observer.disconnect();
                return;
            }
        })
        observer.observe(document.body, {
            childList: true,
            subtree: true
        })
        setTimeout(() => {
            reject(`Timed Out while searching for ${id}`);
        }, 10000);
    })
}

(async function() {
    'use strict';
    console.log("Script Activated...");
    const startButton = document.createElement("button");
    startButton.textContent = "Start Automation";
    Object.assign(startButton.style, {
            position: "fixed",
            top: "20px",
            right: "20px",
            zIndex: "999999",

            padding: "18px 32px",
            fontSize: "20px",
            fontWeight: "bold",

            backgroundColor: "#2563eb",
            color: "#ffffff",

            border: "3px solid #1e40af",
            borderRadius: "12px",

            cursor: "pointer",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.3)"
    });
    document.body.appendChild(startButton);
    startButton.addEventListener('click', async () => {
        await main();
    });

})();