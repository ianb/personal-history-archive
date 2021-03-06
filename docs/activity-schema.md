## Activity Schema

This describes the schema of browsing activity and pages. The schema is intended to be encoded in JSON, but could also end up in a database.

Note: everything marked TODO needs to be added, or maybe adjusted.

### Data Types

**Date / times**: these are represented as milliseconds from the epoch, i.e., the same as what `Date.now()` returns.

**Unknown values**: as far as possible we use `null` as "unknown" values or sometimes "not applicable". Information that can affirmatively be known not to exist should use a different value.

**IDs**: we try to use UUIDs as IDs as often as possible. There may be external IDs (such as history item IDs), and in those cases we use those as secondary IDs.

### Browser

Because people use multiple browsers and profiles, we typically map activity to a specific browser:

`id`: a UUID for the browser

`userAgent`: the User Agent string for the browser

`devicePixelRatio`: the base value of `window.devicePixelRatio` (typically 1 for a normal screen, 2 for a High-DPI/Retina display)

`created`: when we first saw this browser

`testing`: if true, then this browser profile was created specifically for testing. Hopefully these browsers shouldn't show up in your normal data!

`autofetch`: if true, then this browser profile was created or cloned specifically to autofetch pages. It probably has valid cookies/etc, but its behavior isn't "real". Typically we keep these browsers from producing activity, but they *do* create pages (on purpose!) (TODO: need to set `$AUTOFETCH` while building for autofetch; also need to fix autofetch)

#### Session

Browsers also have sessions:

`id`: a UUID for this session (changes each time the browser is restarted)

`startTime`: timestamp when it was started

`endTime`: timestamp when it was closed (often null, because we can't always catch this; may be derived from last saved visit once a new session starts). (TODO: nothing sets this)

`timezoneOffset`: the value of `(new Date()).getTimezoneOffset()`, which is minutes-from-UTC.

#### Derived:

Coming from history:

`oldestHistory`: the time of the oldest history item we've seen

`newestHistory`: the time of the newest history item we've seen

### Activity

There can be two sources of activity: activity created retroactively from browser history, and activity created by the extension.

Browser history typically uses two concepts: the [HistoryItem](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/history/HistoryItem) and the [VisitItem](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/history/VisitItem). In our model we use the VisitItem, augment it with some information from HistoryItem, and there is no one-to-one equivalent of HistoryItem.

`id`: a UUID representing this visit

`browserId`: the browser this is associated with

`sessionId`: the browser session (changed each time the browser is restarted)

`url`: this is the full URL, including the hash.

`title`: the title of the page, null if unknown, `""` if there is no title. (TODO: make sure it's "")

`loadTime`: when the page was loaded

`unloadTime`: when the page was unloaded. This will be null when unknown (browser history does not keep good track of this).

`browserHistoryId`: the ID of the associated [HistoryItem](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/history/HistoryItem). This won't be unique at all, as many visits are associated with the same HistoryItem.

`browserVisitId`: the ID of the associated [VisitItem](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/history/VisitItem). This will probably be unique, if it is set.

`sourceId`: the id of the visit that lead to this visit. This may come from the VisitItem.referringVisitId (but won't match that ID, as we don't use the browserVisitId as our primary key).

`browserReferringVisitId`: from VisitItem.referringVisitId, this should point to another record's `browserVisitId`. Note we try to keep `sourceId` updated, and it's better, but this is kept just in case we need to fix things up later.

`sourceClickHref`: the URL the user clicked on that lead to this page, as from `a.href`. Null if unknown or no link appeared to be the source.

`sourceClickText`: if a click led to this page, the `a.textContent` of that link. Null if unknown or no link appeared to be the source. May be `""`.

`transition`: a string from [TransitionType](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/history/TransitionType): `link`, `typed`, `auto_bookmark`, `auto_subframe` (unlikely, as we don't track frames), `manual_subframe` (also unlikely), `generated`, `auto_toplevel`, `form_submit`, `reload`, `keyword`, `keyword_generated`.

`client_redirect`: a boolean (or null if unknown) from [TransitionQualifier](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/webNavigation/transitionQualifier)

`server_redirect`: a boolean (or null if unknown) from TransitionQualifier

`forward_back`: a boolean (or null if unknown) from TransitionQualifier

`from_address_bar`: a boolean (or null if unknown) from TransitionQualifier

`initialId`: the id of the activity that initiated this. For instance, if you go to `page_1`, click on a link to get to `page_2`, then click on a table of contents to get to `page_2#section2`, then the last item would have a `sourceId` pointing to `page_1`, but an `initialId` pointing to `page_2`. You have to sort on `loadTime` to see the exact order of hash changes.

`newTab`: if this page was opened in a new tab. Typically `sourceId` should be set in this case. It will be null if unknown (for instance VisitItem doesn't record this).

`activeCount`: the number of times this page was made active, for more than a second. If you open a tab in the background, then close it without ever looking at it, then this should be 0. If you interact normally and don't change tabs it would be 1. Higher numbers mean it was revisited several times.

`activeTime`: time in milliseconds that the page was active. Note that if a window goes into the background we keep counting, so this might not always be correct. Like with `activeCount`, we ignore when a tab is active for less than a second, assuming that it means the tab was passed over on the way to another tab. If the user goes idle (no keypresses or mouse movement) for 30 seconds, then we stop incrementing the time until there is activity again.

`unloadReason`: a string indicating why the page was unloaded: `tabClose`, `navigation`. Null if unknown.

`hashPointsToElement`: if the URL has a hash (e.g., `page.html#section1`), then does some element with `id="section1"` exist?

`isHashChange`: if the new activity was an in-page change of the hash/fragment (no actual page loading), then this is true. Null if unknown.

`method`: the HTTP method that loaded the page (usually GET, of course). We do not track the POST destination if it results in an immediate redirect. (TODO: confirm POST behavior)

`statusCode`: the integer status code of the response. E.g., 200, 404.

`contentType`: the Content-Type of the response. Note most URLs are *displayed* as a DOM page of some sort, but the underlying resource might not be text/html. In a case like `text/html; charset="UTF-8"` we remove the charset (and anything after `;`).

`hasSetCookie`: the response contained a `Set-Cookie` header.

`hasCookie`: the request contained a `Cookie` header.

`maxScroll`: the greatest pixel location that this document was scrolled to. Null if unknown, 0 if not scrolled.

`documentHeight`: the pixel height of the document. Null if unknown or if never scrolled.

`copyEvents`: this is a JSON list that represents all the clipboard copies taken from the page. Each event looks like: `{text, startLocation, endLocation, time}`, where start and end location are CSS selectors (`endLocation` may be omitted if it is the same as `startLocation`).

`formControlInteraction`: a count of the number of times a non-text form field was changed. Will be null if we weren't watching.

`formTextInteraction`: a count of the number of times a text form field was changed. Will be null if we weren't watching. This is incremented when the `change` even occurs, so typically you have to unfocus the text field for this to get incremented.

`zoomLevel`: the zoom level, if we can calculate it. Typically 1, null if we didn't determine it. 1.1 means, for example, a 110% zoom.

`canonicalUrl`: if the page has `<link rel="canonical">`, this gives the URL it points to.

`mainFeedUrl`: if the page has an RSS (or similar) feed, what we think is the main feed URL.

`allFeeds`: all the feeds found in the page. This is a list of `[{href, title, type}]`.

`linkInformation`: a list of links found in the document. A list that looks like `[{url, text, rel, target, elementId}]` where `rel`, `target`, and `elementId` are optional (depending on the presence of those attributes), and `url` is the full URL, or if it's an page-internal link then it looks like `"#anchor`.

#### Derived:

This information can be calculated from the above information... (All TODO)

`domain`: the domain, without port, and without leading `www.` or `wwwN.`.

`canonicalUrl`: the URL with UTM and other cruft removed, with query string sorted, and if `containsHash` is true then with the hash removed.

`urlPattern`: a rough pattern of the URL, based on `canonicalUrl`. This helps distinguish homepages from article pages on the same site, for instance. (This heuristic will need some ongoing work.)

`query`: if this was a search result, what was the query string associated?

### Pages

These are full dumps of a page's DOM. They may be associated with a visit, or loaded retroactively to fill in past history. Typically the system does not pull in repeated dumps of pages when they are re-visited (though we may try to do that in the future based on some heuristics).

`id`: a UUID for this *fetch* of a page

`url`: the URL fetched

`loadTime`: the timestamp when we serialized this page (TODO: rename)

`serializeVersion`: a version indicating the serializer. This gets bumped sometimes, so old pages can be re-fetched or updated in place. ([TODO](https://github.com/ianb/personal-history-archive/issues/5))

`autofetched`: true if this was created by an autofetch, as opposed to collected while browsing (TODO)

`activityId`: if this was fetched during browsing, and associated with specific activity, then the ID of that activity.

`redirectUrl`: if fetching the URL redirected to some other URL, then what URL? This is the URL that is actually displayed in the URL bar when we serialized the page. Will be null if this matches `url`.

`redirectOk`: if `redirectUrl` exists, but someone decided the redirect is OK, then this will be true. These can be used to review autofetch redirects, and remove pages that were redirectd to login pages.

`documentSize.width` and `documentSize.height`: height and width of the entire document (not just the visible portion).

`docTitle`: the title as given by `document.title`

`passwordFields`: a list of password fields found

`passwordFields[i].name`: the name attribute of a password field

`passwordFields[i].id`: the id of a password field

`passwordFields[i].hasValue`: true of the field has something entered (e.g., by a password manager)

`passwordFields[i].isHidden`: if the field appears not to be visible

`openGraph`: attributes from Open Graph (i.e., `og:` metadata). From the list: title, type, url, image, audio, description, determiner, locale, site\_name, video, image:secure\_url, image:type, image:width, image:height, video:secure\_url, video:type, video:width, image:height, audio:secure\_url, audio:type, article:published\_time, article:modified\_time, article:expiration\_time, article:author, article:section, article:tag, book:author, book:isbn, book:release\_date, book:tag, profile:first\_name, profile:last\_name, profile:username, profile:gender

`twitterCard`: attributes from Twitter Cards. From the list: card, site, title, description, image, player, player:width, player:height, player:stream, player:stream:content_type

`images`: a list of images in the page. Excludes small images (smaller than 250x200).

`images[i].url`: URL of image

`images[i].dimensions`: `{x: width, y: height}` of the image, as displayed in the document

`images[i].title`: the `title` attribute

`images[i].alt`: the `alt` attribute

`images[i].isReadable`: does the image appear in the Readability version of the document?

`readable`: information extracted with the [Readability](https://github.com/mozilla/readability) library. Null if this didn't appear to be an article or otherwise parseable.

`readable.title`: the title as determined

`readable.content`: an HTML string with the content (not processed like other HTML content)

`readable.textContent`: a text-only version of the content

`readable.length`: the length of the content, in characters

`readable.excerpt`: an exerpt

`readable.byline`: author metadata

`readable.dir`: content direction

#### DOM

These page records give the actual frozen page part of the fetched pages:

`body`: a string of everything *inside* `<body>`.

`head`: a string of everything *inside* `<head>`.

`bodyAttrs`: the attributes in the body tab, like `[["class", "foobar"], ...]`

`headAttrs`: same for head.

`htmlAttrs`: same for `<html>`.

`resources`: links to embedded resources in the page are replaced with UUIDs. `resources` is `{id: description}` for all of these resources.

`resources[id].url`: the fully resolved URL that this points to

`resources[id].tag`: if the URL is embedded in a tag, the name of the tag, like `"LINK"`.

`resources[id].elId`: the the containing element has an id attribute, then it's here

`resources[id].selector`: a selector pointing to the element.

`resources[id].attr`: the attribute name where the URL was found

`resources[id].rel`: in the case of `<link href="..." rel="...">`, the value of `rel`.

`screenshots`: any screenshots taken. Each screenshot has a name. Specifically `screenshots.visible` (what shows in the browser window, "above the fold"), and `screenshots.fullPage` (the entire document).

`screenshots.type.captureType`: how it was captured (typically matches `type`)

`screenshots.type.originalDimensions`: a box of `{top, bottom, left, right}` showing what was captured

`screenshots.type.size`: a value of `{height, width}` of what it was sized to (screenshots are all sized down)

`screenshots.type.image`: a `data:` URL of the image

#### DOM Annotations

The DOM is annotated with some attributes to help understand the DOM without rendering it:

`data-width` and `data-height`: these are added to all images

`data-hidden="true"`: this is added to any element that doesn't appear to be visible (e.g., `display: none`).

`data-display="block"`: or some other value, if `.style.display` (or calculated) is not what you'd expect given the element. E.g., if `<span class="button">` has a style making it display as `inline-block` then this attribute would be added

`value`: this is set to the *actual* form value, not the one in the original HTML.

### Feeds

In addition to the feed-related metadata captured as Activity, we also fetch the actual feeds alongside the page. By doing this we can match up timely feed information against a page.

`feeds`: this is a list of all discovered feeds, listed in the order they appeared in the page.

`feeds[i].url`: the URL of the feed (where it was fetched from)

`feeds[i].redirectUrl`: if the feed redirected, then this is the destination URL

`feeds[i].body`: the text body of the feed.

`feeds[i].contentType`: the HTTP Content-Type given

`feeds[i].lastModified`: the timestamp of the HTTP Last-Modified header

`feeds[i].fetchStart`: the timestamp when we started fetching the feed

`feeds[i].fetchTime`: the number of milliseconds it took to fetch the feed

`feeds[i].error`: if the feed failed to fetch, this text error message describes why.  Other error information:

`feeds[i].statusCode`: if the feed failed to fetch because of an HTTP error, this gives the status code

`feeds[i].status`: and this gives the status text

`feeds[i].errorStack`: if there was an exception fetching the feed, this gives the traceback.

#### Errored pages

`url`: the URL that was attempted to be fetched (we don't store historical failures, so the URL is the primary key).

`attempted`: a timestamp when the error occurred.

`errorMessage`: the error message.
