const DEFAULT_HISTORY_SETTING = { enabled: true };

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    lookupWord(request.word, request.lang)
        .then((content) => {
            sendResponse({ content });

            if (content) {
                browser.storage.local.get().then((results) => {
                    const history = results.history || DEFAULT_HISTORY_SETTING;
                    if (history.enabled) {
                        saveWord(content);
                    }
                });
            }
        })
        .catch((error) => {
            console.error("Dictionary lookup failed:", error);
            sendResponse({ content: null });
        });

    return true;
});

async function lookupWord(rawWord, language) {
    const word = (rawWord || "").trim();
    if (!word) {
        return null;
    }

    if (language === "de") {
        return lookupGerman(word);
    }
    if (language === "fr") {
        return lookupFrench(word);
    }
    if (language === "es") {
        return lookupSpanish(word);
    }

    return lookupEnglish(word);
}

async function lookupEnglish(word) {
    const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
    const response = await fetch(url);
    if (!response.ok) {
        return null;
    }

    const result = await response.json();
    const entries = result.en;
    if (!entries || !entries.length) {
        return null;
    }

    const definitions = [];
    entries.forEach((entry) => {
        (entry.definitions || []).forEach((item) => {
            if (item.definition && definitions.length < 3) {
                definitions.push(htmlToText(item.definition));
            }
        });
    });

    return createContent(word, definitions);
}

async function lookupGerman(word) {
    const parsed = await fetchWiktionaryPage("de", word);
    if (!parsed) {
        return null;
    }

    const heading = Array.from(parsed.querySelectorAll("p")).find((node) => {
        return node.textContent.trim().replace(/:$/, "") === "Bedeutungen";
    });
    const definitionList = heading && heading.nextElementSibling;

    if (!definitionList || definitionList.tagName !== "DL") {
        return null;
    }

    const definitions = Array.from(definitionList.querySelectorAll(":scope > dd"))
        .slice(0, 3)
        .map(cleanDefinitionNode)
        .filter(Boolean);

    return createContent(word, definitions);
}

async function lookupFrench(word) {
    const parsed = await fetchWiktionaryPage("fr", word);
    if (!parsed) {
        return null;
    }

    const section = getLanguageSection(parsed, "fr");
    const definitionList = findFirstInSection(section, "ol:not(.references)");
    if (!definitionList) {
        return null;
    }

    const definitions = Array.from(definitionList.children)
        .filter((node) => node.tagName === "LI")
        .slice(0, 3)
        .map(cleanDefinitionNode)
        .filter(Boolean);

    return createContent(word, definitions);
}

async function lookupSpanish(word) {
    const parsed = await fetchWiktionaryPage("es", word);
    if (!parsed) {
        return null;
    }

    const section = getLanguageSection(parsed, "es");
    const definitions = [];

    section.some((element) => {
        const lists = [];
        if (element.matches && element.matches("dl")) {
            lists.push(element);
        }
        lists.push(...element.querySelectorAll("dl"));

        lists.forEach((list) => {
            const definition = list.querySelector(":scope > dd");
            if (definition && definitions.length < 3) {
                definitions.push(cleanDefinitionNode(definition));
            }
        });

        return definitions.length >= 3;
    });

    return createContent(word, definitions.filter(Boolean));
}

async function fetchWiktionaryPage(language, word) {
    const params = new URLSearchParams({
        action: "parse",
        page: word,
        prop: "text",
        format: "json",
        origin: "*"
    });
    const url = `https://${language}.wiktionary.org/w/api.php?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
        return null;
    }

    const result = await response.json();
    if (!result.parse || !result.parse.text) {
        return null;
    }

    return new DOMParser().parseFromString(result.parse.text["*"], "text/html");
}

function getLanguageSection(parsed, languageId) {
    const marker = parsed.getElementById(languageId);
    const heading = marker && marker.closest("h2");
    const headingContainer = heading && heading.parentElement;
    const elements = [];

    if (!headingContainer) {
        return elements;
    }

    let current = headingContainer.nextElementSibling;
    while (current && !current.classList.contains("mw-heading2")) {
        elements.push(current);
        current = current.nextElementSibling;
    }

    return elements;
}

function findFirstInSection(section, selector) {
    for (const element of section) {
        if (element.matches && element.matches(selector)) {
            return element;
        }

        const match = element.querySelector(selector);
        if (match) {
            return match;
        }
    }

    return null;
}

function cleanDefinitionNode(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll("ul, ol, dl, sup, .example, .sources").forEach((child) => {
        child.remove();
    });
    return copy.textContent.replace(/^\s*\[?\d+[\],.\s]*/, "").replace(/\s+/g, " ").trim();
}

function createContent(word, definitions) {
    if (!definitions || !definitions.length) {
        return null;
    }

    return {
        word,
        meaning: definitions.join("; "),
        audioSrc: null
    };
}

function htmlToText(html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return parsed.body.textContent.replace(/\s+/g, " ").trim();
}

function saveWord(content) {
    browser.storage.local.get("definitions").then((results) => {
        const definitions = results.definitions || {};
        definitions[content.word] = content.meaning;
        browser.storage.local.set({ definitions });
    });
}
