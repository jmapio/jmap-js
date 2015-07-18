# JMAP-JS

JMAP-JS is an implementation of the JMAP mail, contacts and calendars model. JMAP is a new, very efficient protocol for synchronising mail, calendars and contacts with a server. Learn more at http://jmap.io

JMAP is MIT licensed. Please see the LICENSE file in the repository for full details.

## Dependencies

JMAP-JS requires the [Overture](https://github.com/fastmail/overture) library's core, foundation, datastore, io, timezones, ua and localisation modules.

To build the time zone data you will need a copy of the [Olsen database](https://www.iana.org/time-zones). There is a script included with Overture to convert the raw data into the required format.

## Usage guide

This guide is intended to get you up and running with your own JMAP client as quickly as possible. Everything used in the [demo JMAP webmail](https://proxy.jmap.io) is covered; looking at [the source code of this](https://github.com/jmapio/jmap-demo-webmail) is also a great way to learn how to use the library.

At some point you'll probably want to extend the classes with custom methods, or extra attributes, or need to do something crazier; if this happens, you might want to consult the [documentation for the Overture library](http://overturejs.com/docs/) for details of the underlying framework this is built on.

### Authenticating

Before you can fetch any data, you need to authenticate the user to get an access token and the set of URLs to use for the various JMAP endpoints (see [the auth spec](http://jmap.io/spec.html#authentication)). This is not handled for you by the library; it's mainly UI work and the library is all about the data model.

Once you've authenticated, you need to call `JMAP.auth.didAuthenticate`. This takes 3 arguments:

* `username`: the username that has been logged in with (not strictly needed, but you will find it useful to be able to reference it on the auth object.)
* `accessToken`: the access token returned by the server after logging in, used to authenticate all requests.
* `urls`: an object with the following properties:
   - `authenticationUrl`: the URL used for authentication; the library will use
     this to refetch the other end points if needed.
   - `apiUrl`: the API URL returned by the server.
   - `eventSourceUrl`: the EventSourceUrl URL returned by the server.
   - `uploadUrl`: the Upload URL returned by the server.
   - `downloadUrl`: the Download URL (template) returned by the server.

#### Getting a specific record by id

Each type in the JMAP model is represented by a class in the library, with the same name as in the spec. So for example, `JMAP.Message` is the class that represents a JMAP Message object. If you have a specific message id, you can get the instance representing this record by calling `JMAP.store.getRecord( Type, id );`, where `Type` is the Class (constructor function) for the type, e.g. `JMAP.Message`.

This returns a JMAP.Message object immediately, although the data may not yet be loaded. You can set up [bindings](http://overturejs.com/docs/foundation/Binding.html) and the record will pass through the data when it loads. You can also monitor the status of the record by [observing](http://overturejs.com/docs/foundation/ObservableProps.html#O_ObservableProps_addObserverForKey)) the `status` property of the object. This is a bit field [representing the current status – loading, ready, committing, etc. – of the object](http://overturejs.com/docs/datastore/record/Status.html). You can test the value of this against the `O.Status` constants to check the status. There's also a helper method you can use: `record.is( O.Status.READY )`, for example, would return `true` if the data has loaded. The main statuses you will use here are:

- `O.Status.EMPTY`: The record has not been loaded yet (the store will automatically fetch it when you called `getRecord`.)
- `O.Status.READY`: The record is loaded and ready to use.
- `O.Status.NON_EXISTENT`: The source does not have a record with the requested id.

#### Queries

There are two types of queries: remote and live/local. Remotes queries are calculated on the server and are used when the complete data needed for the query is not available to the client, while live queries are used when we know we have all the data locally, so we can calculate the query in the client. The JMAP-JS library uses remote queries for message lists and local queries for everything else.

In either case, the following methods will be useful:

* `getObjectAt( index: Number )` – returns the record at the given index.
* `get( 'length' )` – returns the number of records in the query.
* `get( 'status' )` – returns the status of the query. Mostly you're just
   checking if it is O.Status.READY yet.
* `addObserverForRange( range: { start: Number, end: Number}, object: Object, method: String )` - the given `method` will be called on the given `object` whenever there is a change in the set of records in the range between start and end. If start is omitted it is taken to be 0 (the first element in the enumerable). If end is ommitted it is taken to be the length of the list. start is inclusive and end is exclusive, e.g. {start: 1, end: 2} will only fire if the record at index 1 changes. You can modify the start and end properties on the range object passed in at any time to change the portion of the list you wish to be notified about.
* `addObserverForKey( '[]', object: Object, method: String ) – register an observer to be notifed whenever the set of records in the query changes. Note, this does *not* fire just because a property on a record in the query changed – views should observe the records directly to detect this.
* `destroy()` – if you've finished with a query, call destroy to stop the store from continuing to keep it updated and to remove references to it from the store. This is important so you don't leak memory.

### Mail

There are premade queries for the two most common lists of mailboxes you might want:

* `JMAP.mail.rootMailboxes` is a live query on the list of root mailboxes (mailboxes with no parent).
* `JMAP.mail.allMailboxes` is a live query of all mailboxes.

In both cases, the list is sorted in the order it should be displayed, with child mailboxes immediately after their parents, and within that sorted by "sortOrder", then "name".

A live-updating index of the system folders is available at `JMAP.mail.systemMailboxIds` – it maps [roles](http://jmap.io/spec.html#mailboxes) to mailbox ids.

#### Message lists

A message list represents the list of messages in a particular mailbox, or matching a particular search. This is how you get one:

JMAP.store.getQuery( 'inbox', JMAP.MessageList, {
    filter: { inMailboxes: [ JMAP.mail.systemMailboxIds.get( 'inbox' ) ] },
    sort: [ 'date desc' ],
    collapseThreads: true
});

The above example would return a query whose result is the list of all threads in the inbox, newest first. The [Store#getQuery]() method takes 3 arguments: the first is an id which you can assign – if you make a subsequent call with the same id, and the message list hasn't been garbage collected, the method will return the same object (ignoring any subsequent arguments). The second argument is the query type, and finally the third argument is an object of arguments for the query: filter and sort are [as specified in the JMAP spec](http://jmap.io/spec.html#messagelists).

#### Actions

For efficiency, some data in the JMAP model is denormalised. For example, the mailbox object has unread and total counts, which are really queries on the set of messages. To ensure that these are preemptively updated when you action the messages, so your client UI has a consistent view of the data, use the following methods to action messages. In each case the, first argument is an array of `JMAP.Message` objects to perform the action on.

* `JMAP.mail.setUnread( messages, isUnread, allowUndo )` – sets the "isUnread" property of each message in the list (1st arg) to the value specified in the second arg. If `allowUndo = true`, the inverse operation will be added to the undo stack.
* `JMAP.mail.setFlagged( messages, isFlagged, allowUndo )` – sets the "isFlagged" property of each message in the list (1st arg) to the value specified in the second arg. If `allowUndo = true`, the inverse operation will be added to the undo stack.
* `JMAP.mail.move( messages, addMailboxId, removeMailboxId, allowUndo )` – for each message, if it's not already in the mailbox with the `addMailboxId` id, it will be added to it. If it's in the mailbox with the `removeMailboxId` id, it will be removed from it. Both addMailboxId and removeMailboxId may be `null`, so this method can also be used purely to add or remove "labels" on systems that support assigning messages to multiple mailboxes.
* `JMAP.mail.destroy( messages )` – **permanently** deletes the messages. To delete to Trash, use `JMAP.mail.move( messages, JMAP.systemMailboxIds.get( 'trash' ), null )`.
* `JMAP.mail.report( messages, asSpam, allowUndo )` – reports a message as spam or non-spam. This does *not* move the message automatically; you will need to explicitly call `JMAP.mail.move` to do this.

Actions in the API will often be combined in the actions presented at the UI level. For example, the "Archive" action may set the messages as read, move them to the archive mailbox and maybe even report them as non-spam as well.

After doing the actions, you need to call `JMAP.mail.undoManager.saveUndoCheckpoint()` to record a new undo point with all the actions that have just been performed. You can then undo the whole set by calling `JMAP.mail.undoManager.undo()`.

`JMAP.mail.getMessages` is a helper function for loading a set of messages from a list of message ids. The first argument is an array of message ids, which you can get from a MessageList without having to even load the headers. The second argument is about whether to also add other messages in the same thread (`1`) or same thread and same mailbox (`2`).

#### Garbage collection

A user may have gigabytes of email. Keeping all this in memory is not ideal. The library has a simple little garbage collector that runs once a minute and removes the least recently used records in the cache when the count of records in the store goes over a limit. The predefined limits are:

- Message: 1200
- Thread: 1000
- MessageList: 5

Mailboxes, Contacts, Calendars are not garbage collected by default.

### Contacts

#### Looking up a contact by email

`JMAP.contacts.getContactFromEmail( email: String )`

Searches the contacts currently loaded in memory for one with an email equal to the given value (case-insensitive). Will return either the `JMAP.contact` object for the contact if found, or `null` if none have the given email. If more than one contact has the email, one of them will be returned, but it is undefined which one.

#### Getting a list of all contacts

Use a local (live) query to filter contacts. To get all contacts, you could do:

    new O.LiveQuery({
        store: JMAP.store,
        Type: JMAP.Contact,
        sort: [ 'firstName', 'lastName', 'id' ]
    });

#### Making changes

To edit contacts or calendar events, you can make use of a copy-on-write view of
the main store, called a [nested store](http://overturejs.com/docs/datastore/store/NestedStore.html).

    // Get a contact object referenced to the contacts edit store
    var contactToEdit = contact.getDoppelganger( JMAP.contacts.editStore );
    // ... make changes (you can two-way bind directly to the contact props)
    contactToEdit.set( 'firstName', 'Paul' );
    // ... then to save (automatically records undo point):
    JMAP.contacts.editStore.commitChanges();
    // ... or to discard
    JMAP.contacts.editStore.discardChanges();

The undo manager will automatically register a new undo checkpoint each time
you commit your changes in the edit store back to the main store. You can
undo/redo by calling the appropriate method on `JMAP.contacts.undoManager`.

### Calendars

The primary method you need is `JMAP.calendar.getEventsForDate( date, allDay )`, where `date` is expected to be a Date object whose UTC time value is midnight at the beginning of the day for which you want a list of events; `allDay` is a number: 0 (return both all day and non-all-day events), 1 (only return all day events), -1 (only return non-all-day events). The return value is an observable list which you can treat just like a query as described above. Remember to destroy it when you no longer need the list of events for that day!

The library keeps all events in a contiguous time range in memory. The range is automatically extended as needed when you call `getEventsForDate`. `JMAP.calendar.loadedEventsStart` and `JMAP.calendar.loadedEventsEnd` are observable properties, which between them define the date range which is loaded. You can use this to determine whether the user's current view is fully loaded or not.

The `JMAP.calendar.timeZone` property is the time zone used to view the user's calendars in. The library will automatically do the time zone conversions needed to work out which events fall on the day(s) requested with getEventsForDate. If you set a different time zone (which must be an instance of `O.TimeZone`, or `null` for floating time), all the active day queries will automatically update.

The `JMAP.calendar.showDeclined` is a boolean value determining whether to show declined events or not. If set, all the active day queries will automatically update.

#### Actions

Like with contacts, you can use `JMAP.calendar.editStore` to directly create, edit or destroy calendar events, then commit the changes, which also records an undo point, and `JMAP.calendar.undoManager` to undo/redo.
