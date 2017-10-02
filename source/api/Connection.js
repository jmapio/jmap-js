// -------------------------------------------------------------------------- \\
// File: Connection.js                                                        \\
// Module: API                                                                \\
// Requires: Auth.js                                                          \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, JSON, console, alert */

'use strict';

( function ( JMAP ) {

var delta = function ( update ) {
    var records = update.records,
        changes = update.changes,
        i, l = records.length,
        delta = new Array( l );

    for ( i = 0; i < l; i += 1 ) {
        delta[i] = Object.filter( records[i], changes[i] );
    }
    return delta;
};

var toPrimaryKey = function ( primaryKey, record ) {
    return record[ primaryKey ];
};

var makeSetRequest = function ( change ) {
    var create = change.create;
    var update = change.update;
    var destroy = change.destroy;
    return {
        create: Object.zip( create.storeKeys, create.records ),
        update: Object.zip(
            update.records.map(
                toPrimaryKey.bind( null, change.primaryKey )
            ), delta( update )
        ),
        destroy: destroy.ids
    };
};

var handleProps = {
    precedence: 'commitPrecedence',
    fetch: 'recordFetchers',
    refresh: 'recordRefreshers',
    commit: 'recordCommitters',
    create: 'recordCreators',
    update: 'recordUpdaters',
    destroy: 'recordDestroyers',
    query: 'queryFetchers'
};

/**
    Class: JMAP.Connection

    Extends: O.Source

    An Connection communicates with a server using a JSON protocol conformant
    with the [JMAP](http://jmap.io) standard, allowing multiple fetches and
    commits to be batched into a single HTTP request for efficiency, with
    requests for the same type of object grouped together.

    A request consists of a JSON array, with each element in the array being
    itself an array of three elements, the first a method name, the second an
    object consisting of named arguments, and the third a tag used to associate
    the request with the response:

        [
            [ 'method', {
                arg1: 'foo',
                arg2: 'bar'
            }, '#1' ],
            [ 'method2', {
                foo: [ 'an', 'array' ],
                bar: 42
            }, '#2' ]
        ]

    The response is expected to be in the same format, with methods from
    <JMAP.Connection#response> available to the server to call.
*/
var Connection = O.Class({

    Extends: O.Source,

    /**
        Constructor: JMAP.Connection

        Parameters:
            mixin - {Object} (optional) Any properties in this object will be
                    added to the new O.Object instance before initialisation (so
                    you can pass it getter/setter functions or observing
                    methods). If you don't specify this, your source isn't going
                    to do much!
    */
    init: function ( mixin ) {
        // List of method/args queued for sending in the next request.
        this._sendQueue = [];
        // List of callback functions to be executed after the next request.
        this._callbackQueue = [];

        // Map of id -> RemoteQuery for all queries to be fetched.
        this._queriesToFetch = {};
        // Map of guid( Type ) -> state
        this._typesToRefresh = {};
        // Map of guid( Type ) -> Id -> true
        this._recordsToRefresh = {};
        // Map of guid( Type ) -> null
        this._typesToFetch = {};
        // Map of guid( Type ) -> Id -> true
        this._recordsToFetch = {};

        this.inFlightRemoteCalls = null;
        this.inFlightCallbacks = null;
        this.inFlightRequest = null;

        Connection.parent.init.call( this, mixin );
    },

    prettyPrint: false,

    /**
        Property: JMAP.Connection#willRetry
        Type: Boolean

        If true, retry the request if the connection fails or times out.
    */
    willRetry: true,

    /**
        Property: JMAP.Connection#timeout
        Type: Number

        Time in milliseconds at which to time out the request. Set to 0 for no
        timeout.
    */
    timeout: 30000,

    /**
        Property: JMAP.Connection#inFlightRequest
        Type: (O.HttpRequest|null)

        The HttpRequest currently in flight.
    */
    inFlightRequest: null,

    /**
        Method: JMAP.Connection#ioDidSucceed

        Callback when the IO succeeds. Parses the JSON and passes it on to
        <JMAP.Connection#receive>.

        Parameters:
            event - {IOEvent}
    */
    ioDidSucceed: function ( event ) {
        // Check data is in the correct format
        var data = event.data;
        if ( !( data instanceof Array ) ) {
            O.RunLoop.didError({
                name: 'JMAP.Connection#ioDidSucceed',
                message: 'Data from server is not JSON.',
                details: 'Data:\n' + event.data +
                    '\n\nin reponse to request:\n' +
                    JSON.stringify( this.get( 'inFlightRemoteCalls' ), null, 2 )
            });
            data = [];
        }

        JMAP.auth.connectionSucceeded( this );

        this.receive(
            data,
            this.get( 'inFlightCallbacks' ),
            this.get( 'inFlightRemoteCalls' )
        );

        this.set( 'inFlightRemoteCalls', null )
            .set( 'inFlightCallbacks', null );
    }.on( 'io:success' ),

    /**
        Method: JMAP.Connection#ioDidFail

        Callback when the IO fails.

        Parameters:
            event - {IOEvent}
    */
    ioDidFail: function ( event ) {
        var discardRequest = false;
        var auth = JMAP.auth;
        var status = event.status;

        switch ( status ) {
        // 400: Bad Request
        // 413: Payload Too Large
        case 400:
        case 413:
            var response = event.data;
            O.RunLoop.didError({
                name: 'JMAP.Connection#ioDidFail',
                message: 'Bad request made: ' + status,
                details: 'Request was:\n' +
                    JSON.stringify(
                        this.get( 'inFlightRemoteCalls' ), null, 2 ) +
                    '\n\nResponse was:\n' +
                    ( response ? JSON.stringify( response, null, 2 ) :
                        '(no data, the response probably wasn’t valid JSON)' ),
            });
            discardRequest = true;
            break;
        // 401: Unauthorized
        case 401:
            auth.didLoseAuthentication()
                .connectionWillSend( this );
            break;
        // 404: Not Found
        case 404:
            auth.refindEndpoints()
                .connectionWillSend( this );
            break;
        // 429: Rate Limited
        // 503: Service Unavailable
        // Wait a bit then try again
        case 429:
        case 503:
            auth.connectionFailed( this, 30 );
            break;
        // 500: Internal Server Error
        case 500:
            alert( O.loc( 'FEEDBACK_SERVER_FAILED' ) );
            discardRequest = true;
            break;
        // Presume a connection error. Try again if willRetry is set,
        // otherwise discard.
        default:
            if ( this.get( 'willRetry' ) ) {
                auth.connectionFailed( this );
            } else {
                discardRequest = true;
            }
        }

        if ( discardRequest ) {
            this.receive(
                [],
                this.get( 'inFlightCallbacks' ),
                this.get( 'inFlightRemoteCalls' )
            );

            this.set( 'inFlightRemoteCalls', null )
                .set( 'inFlightCallbacks', null );
        }
    }.on( 'io:failure', 'io:abort' ),

    /**
        Method: JMAP.Connection#ioDidEnd

        Callback when the IO ends.

        Parameters:
            event - {IOEvent}
    */
    ioDidEnd: function ( event ) {
        // Send any waiting requests
        this.set( 'inFlightRequest', null )
            .send();
        // Destroy old HttpRequest object.
        event.target.destroy();
    }.on( 'io:end' ),

    /**
        Method: JMAP.Connection#callMethod

        Add a method call to be sent on the next request and trigger a request
        to be sent at the end of the current run loop.

        Parameters:
            name     - {String} The name of the method to call.
            args     - {Object} The arguments for the method.
            callback - {Function} (optional) A callback to execute after the
                       request completes successfully.
    */
    callMethod: function ( name, args, callback ) {
        var id = this._sendQueue.length + '';
        this._sendQueue.push([ name, args || {}, id ]);
        if ( callback ) {
            this._callbackQueue.push([ id, callback ]);
        }
        this.send();
        return this;
    },

    addCallback: function ( callback ) {
        this._callbackQueue.push([ '', callback ]);
        return this;
    },

    hasRequests: function () {
        var id;
        if ( this.get( 'inFlightRemoteCalls' ) || this._sendQueue.length ) {
            return true;
        }
        for ( id in this._queriesToFetch ) {
            return true;
        }
        for ( id in this._recordsToFetch ) {
            return true;
        }
        for ( id in this._recordsToRefresh ) {
            return true;
        }
        return false;
    },

    headers: function () {
        return {
            'Content-type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Bearer ' + JMAP.auth.get( 'accessToken' )
        };
    }.property().nocache(),

    /**
        Method: JMAP.Connection#send

        Send any queued method calls at the end of the current run loop.
    */
    send: function () {
        if ( this.get( 'inFlightRequest' ) ||
                !JMAP.auth.connectionWillSend( this ) ) {
            return;
        }

        var remoteCalls = this.get( 'inFlightRemoteCalls' );
        var request;
        if ( !remoteCalls ) {
            request = this.makeRequest();
            remoteCalls = request[0];
            if ( !remoteCalls.length ) { return; }
            this.set( 'inFlightRemoteCalls', remoteCalls );
            this.set( 'inFlightCallbacks', request[1] );
        }

        this.set( 'inFlightRequest',
            new O.HttpRequest({
                nextEventTarget: this,
                timeout: this.get( 'timeout' ),
                method: 'POST',
                url: JMAP.auth.get( 'apiUrl' ),
                headers: this.get( 'headers' ),
                withCredentials: true,
                responseType: 'json',
                data: JSON.stringify( remoteCalls,
                    null, this.get( 'prettyPrint' ) ? 2 : 0 )
            }).send()
        );
    }.queue( 'after' ),

    /**
        Method: JMAP.Connection#receive

        After completing a request, this method is called to process the
        response returned by the server.

        Parameters:
            data        - {Array} The array of method calls to execute in
                          response to the request.
            callbacks   - {Array} The array of callbacks to execute after the
                          data has been processed.
            remoteCalls - {Array} The array of method calls that was executed on
                          the server.
    */
    receive: function ( data, callbacks, remoteCalls ) {
        var handlers = this.response,
            i, l, response, handler,
            tuple, id, callback, request;
        for ( i = 0, l = data.length; i < l; i += 1 ) {
            response = data[i];
            handler = handlers[ response[0] ];
            if ( handler ) {
                id = response[2];
                request = remoteCalls[+id];
                try {
                    handler.call( this, response[1], request[0], request[1] );
                } catch ( error ) {
                    O.RunLoop.didError( error );
                }
            }
        }
        // Invoke after bindings to ensure all data has propagated through.
        if ( ( l = callbacks.length ) ) {
            for ( i = 0; i < l; i += 1 ) {
                tuple = callbacks[i];
                id = tuple[0];
                callback = tuple[1];
                if ( id ) {
                    request = remoteCalls[+id];
                    /* jshint ignore:start */
                    response = data.filter( function ( call ) {
                        return call[2] === id;
                    });
                    /* jshint ignore:end */
                    callback = callback.bind( null, response, request );
                }
                O.RunLoop.queueFn( 'middle', callback );
            }
        }
    },

    /**
        Method: JMAP.Connection#makeRequest

        This will make calls to JMAP.Connection#(record|query)(Fetchers|Refreshers)
        to add any final API calls to the send queue, then return a tuple of the
        queue of method calls and the list of callbacks.

        Returns:
            {Array} Tuple of method calls and callbacks.
    */
    makeRequest: function () {
        var sendQueue = this._sendQueue,
            callbacks = this._callbackQueue,
            recordRefreshers = this.recordRefreshers,
            recordFetchers = this.recordFetchers,
            _queriesToFetch = this._queriesToFetch,
            _typesToRefresh = this._typesToRefresh,
            _recordsToRefresh = this._recordsToRefresh,
            _typesToFetch = this._typesToFetch,
            _recordsToFetch = this._recordsToFetch,
            typeId, id, req, state, ids, handler;

        // Query Fetches
        for ( id in _queriesToFetch ) {
            req = _queriesToFetch[ id ];
            handler = this.queryFetchers[ O.guid( req.constructor ) ];
            if ( handler ) {
                handler.call( this, req );
            }
        }

        // Record Refreshers
        for ( typeId in _typesToRefresh ) {
            state = _typesToRefresh[ typeId ];
            handler = recordRefreshers[ typeId ];
            if ( typeof handler === 'string' ) {
                this.callMethod( handler, {
                    sinceState: state
                });
            } else {
                handler.call( this, null, state );
            }
        }
        for ( typeId in _recordsToRefresh ) {
            handler = recordRefreshers[ typeId ];
            ids = Object.keys( _recordsToRefresh[ typeId ] );
            if ( typeof handler === 'string' ) {
                this.callMethod( handler, {
                    ids: ids
                });
            } else {
                recordRefreshers[ typeId ].call( this, ids );
            }
        }

        // Record fetches
        for ( typeId in _typesToFetch ) {
            handler = recordFetchers[ typeId ];
            if ( typeof handler === 'string' ) {
                this.callMethod( handler );
            } else {
                handler.call( this, null );
            }
        }
        for ( typeId in _recordsToFetch ) {
            handler = recordFetchers[ typeId ];
            ids = Object.keys( _recordsToFetch[ typeId ] );
            if ( typeof handler === 'string' ) {
                this.callMethod( handler, {
                    ids: ids
                });
            } else {
                recordFetchers[ typeId ].call( this, ids );
            }
        }

        // Any future requests will be added to a new queue.
        this._sendQueue = [];
        this._callbackQueue = [];

        this._queriesToFetch = {};
        this._typesToRefresh = {};
        this._recordsToRefresh = {};
        this._typesToFetch = {};
        this._recordsToFetch = {};

        return [ sendQueue, callbacks ];
    },

    // ---

    /**
        Method: JMAP.Connection#fetchRecord

        Fetches a particular record from the source. Just passes the call on to
        <JMAP.Connection#fetchRecords>.

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchRecord: function ( Type, id, callback ) {
        return this.fetchRecords( Type, [ id ], callback, '', false );
    },

    /**
        Method: JMAP.Connection#fetchAllRecords

        Fetches all records of a particular type from the source. Just passes
        the call on to <JMAP.Connection#fetchRecords>.

        Parameters:
            Type     - {O.Class} The record type.
            state    - {(String|undefined)} The state to update from.
            callback - {Function} (optional) A callback to make after the fetch
                       completes.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchAllRecords: function ( Type, state, callback ) {
        return this.fetchRecords( Type, null, callback, state || '', !!state );
    },

    /**
        Method: JMAP.Connection#refreshRecord

        Fetches any new data for a record since the last fetch if a handler for
        the type is defined in <JMAP.Connection#recordRefreshers>, or refetches the
        whole record if not.

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       refresh completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the refresh.
    */
    refreshRecord: function ( Type, id, callback ) {
        return this.fetchRecords( Type, [ id ], callback, '', true );
    },

    /**
        Method: JMAP.Connection#fetchRecords

        Fetches a set of records of a particular type from the source.

        Parameters:
            Type     - {O.Class} The record type.
            ids      - {(String[]|null)} An array of record ids to fetch, or
                       `null`, indicating that all records of this type should
                       be fetched.
            callback - {Function} (optional) A callback to make after the record
                       fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchRecords: function ( Type, ids, callback, state, _refresh ) {
        var typeId = O.guid( Type ),
            handler = _refresh ?
                this.recordRefreshers[ typeId ] :
                this.recordFetchers[ typeId ];
        if ( _refresh && !handler ) {
            _refresh = false;
            handler = this.recordFetchers[ typeId ];
        }
        if ( !handler ) {
            return false;
        }
        if ( ids ) {
            var reqs = _refresh? this._recordsToRefresh : this._recordsToFetch,
                set = reqs[ typeId ] || ( reqs[ typeId ] = {} ),
                l = ids.length;
            while ( l-- ) {
                set[ ids[l] ] = true;
            }
        } else if ( _refresh ) {
            this._typesToRefresh[ typeId ] = state;
        } else {
            this._typesToFetch[ typeId ] = null;
        }
        if ( callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        this.send();
        return true;
    },

    /**
        Property: JMAP.Connection#commitPrecedence
        Type: String[Number]|null
        Default: null

        This is on optional mapping of type guids to a number indicating the
        order in which they are to be committed. Types with lower numbers will
        be committed first.
    */
    commitPrecedence: null,

    /**
        Method: JMAP.Connection#commitChanges

        Commits a set of creates/updates/destroys to the source. These are
        specified in a single object, which has record type guids as keys and an
        object with create/update/destroy properties as values. Those properties
        have the following types:

        create  - `[ [ storeKeys... ], [ dataHashes... ] ]`
        update  - `[ [ storeKeys... ], [ dataHashes... ], [changedMap... ] ]`
        destroy - `[ [ storeKeys... ], [ ids... ] ]`

        Each subarray inside the 'create' array should be of the same length,
        with the store key at position 0 in the first array, for example,
        corresponding to the data object at position 0 in the second. The same
        applies to the update and destroy arrays.

        A changedMap, is a map of attribute names to a boolean value indicating
        whether that value has actually changed. Any properties in the data
        which are not in the changed map are presumed unchanged.

        An example call might look like:

            source.commitChanges({
                MyType: {
                    primaryKey: 'id',
                    create: {
                        storeKeys: [ 'sk1', 'sk2' ],
                        records: [{ attr: val, attr2: val2 ...}, {...}],
                    },
                    update: {
                        storeKeys: [ 'sk3', 'sk4', ... ],
                        records: [{ id: 'id3', attr: val ... }, {...}],
                        changes: [{ attr: true }, ... ],
                    },
                    destroy: {
                        storeKeys: [ 'sk5', 'sk6' ],
                        ids: [ 'id5', 'id6' ],
                    },
                    state: 'i425m515233',
                },
                MyOtherType: {
                    ...
                },
            });

        Any types that are handled by the source are removed from the changes
        object (`delete changes[ typeId ]`); any unhandled types are left
        behind, so the object may be passed to several sources, with each
        handling their own types.

        In a RPC source, this method considers each type in the changes. If that
        type has a handler defined in <JMAP.Connection#recordCommitters>, then this
        will be called with the create/update/destroy object as the sole
        argument, otherwise it will look for separate handlers in
        <JMAP.Connection#recordCreators>, <JMAP.Connection#recordUpdaters> and
        <JMAP.Connection#recordDestroyers>. If handled by one of these, the method
        will remove the type from the changes object.

        Parameters:
            changes  - {Object} The creates/updates/destroys to commit.
            callback - {Function} (optional) A callback to make after the
                       changes have been committed.

        Returns:
            {Boolean} Returns true if any of the types were handled. The
            callback will only be called if the source is handling at least one
            of the types being committed.
    */
    commitChanges: function ( changes, callback ) {
        var types = Object.keys( changes ),
            l = types.length,
            precedence = this.commitPrecedence,
            handledAny = false,
            type, handler, handledType,
            change, create, update, destroy;

        if ( precedence ) {
            types.sort( function ( a, b ) {
                return ( precedence[b] || -1 ) - ( precedence[a] || -1 );
            });
        }

        while ( l-- ) {
            type = types[l];
            change = changes[ type ];
            handler = this.recordCommitters[ type ];
            handledType = false;
            create = change.create;
            update = change.update;
            destroy = change.destroy;
            if ( handler ) {
                if ( typeof handler === 'string' ) {
                    this.callMethod( handler, makeSetRequest( change ) );
                } else {
                    handler.call( this, change );
                }
                handledType = true;
            } else {
                handler = this.recordCreators[ type ];
                if ( handler ) {
                    handler.call( this, create.storeKeys, create.records );
                    handledType = true;
                }
                handler = this.recordUpdaters[ type ];
                if ( handler ) {
                    handler.call( this,
                        update.storeKeys, update.records, update.changes );
                    handledType = true;
                }
                handler = this.recordDestroyers[ type ];
                if ( handler ) {
                    handler.call( this, destroy.storeKeys, destroy.ids );
                    handledType = true;
                }
            }
            if ( handledType ) {
                delete changes[ type ];
            }
            handledAny = handledAny || handledType;
        }
        if ( handledAny && callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        return handledAny;
    },

    /**
        Method: JMAP.Connection#fetchQuery

        Fetches the data for a remote query from the source.

        Parameters:
            query - {O.RemoteQuery} The query to fetch.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchQuery: function ( query, callback ) {
        if ( !this.queryFetchers[ O.guid( query.constructor ) ] ) {
            return false;
        }
        var id = query.get( 'id' );

        this._queriesToFetch[ id ] = query;

        if ( callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        this.send();
        return true;
    },

    /**
        Method: JMAP.Connection#handle

        Helper method to register handlers for a particular type. The handler
        object may include methods with the following keys:

        - precedence: Add function to `commitPrecedence` handlers.
        - fetch: Add function to `recordFetchers` handlers.
        - refresh: Add function to `recordRefreshers` handlers.
        - commit: Add function to `recordCommitters` handlers.
        - create: Add function to `recordCreators` handlers.
        - update: Add function to `recordUpdaters` handlers.
        - destroy: Add function to `recordDestroyers` handlers.
        - query: Add function to `queryFetcher` handlers.

        Any other keys are presumed to be a response method name, and added
        to the `response object.

        Parameters:
            Type     - {O.Class} The type these handlers are for.
            handlers - {string[function]} The handlers. These are registered
                       as described above.

        Returns:
            {JMAP.Connection} Returns self.
    */
    handle: function ( Type, handlers ) {
        var typeId = O.guid( Type );
        var action, propName, isResponse, actionHandlers;
        for ( action in handlers ) {
            propName = handleProps[ action ];
            isResponse = !propName;
            if ( isResponse ) {
                propName = 'response';
            }
            actionHandlers = this[ propName ];
            if ( !this.hasOwnProperty( propName ) ) {
                this[ propName ] = actionHandlers =
                    Object.create( actionHandlers );
            }
            actionHandlers[ isResponse ? action : typeId ] = handlers[ action ];
        }
        if ( Type ) {
            Type.source = this;
        }
        return this;
    },

    /**
        Property: JMAP.Connection#recordFetchers
        Type: String[Function]

        A map of type guids to functions which will fetch records of that type.
        The functions will be called with the source as 'this' and a list of ids
        or an object (passed straight through from your program) as the sole
        argument.
    */
    recordFetchers: {},

    /**
        Property: JMAP.Connection#recordRefreshers
        Type: String[Function]

        A map of type guids to functions which will refresh records of that
        type. The functions will be called with the source as 'this' and a list
        of ids or an object (passed straight through from your program) as the
        sole argument.
    */
    recordRefreshers: {},

    /**
        Property: JMAP.Connection#recordCommitters
        Type: String[Function]

        A map of type guids to functions which will commit all creates, updates
        and destroys requested for a particular record type.
    */
    recordCommitters: {},

    /**
        Property: JMAP.Connection#recordCreators
        Type: String[Function]

        A map of type guids to functions which will commit creates for a
        particular record type. The function will be called with the source as
        'this' and will get the following arguments:

        storeKeys - {String[]} A list of store keys.
        data      - {Object[]} A list of the corresponding data object for
                    each store key.

        Once the request has been made, the following callbacks must be made to
        the <O.Store> instance as appropriate:

        * <O.Store#sourceDidCommitCreate> if there are any commited creates.
        * <O.Store#sourceDidNotCreate> if there are any rejected creates.
    */
    recordCreators: {},

    /**
        Property: JMAP.Connection#recordUpdaters
        Type: String[Function]

        A map of type guids to functions which will commit updates for a
        particular record type. The function will be called with the source as
        'this' and will get the following arguments:

        storeKeys - {String[]} A list of store keys.
        data      - {Object[]} A list of the corresponding data object for
                    each store key.
        changed   - {String[Boolean][]} A list of objects mapping attribute
                    names to a boolean value indicating whether that value has
                    actually changed. Any properties in the data has not in the
                    changed map may be presumed unchanged.

        Once the request has been made, the following callbacks must be made to
        the <O.Store> instance as appropriate:

        * <O.Store#sourceDidCommitUpdate> if there are any commited updates.
        * <O.Store#sourceDidNotUpdate> if there are any rejected updates.
    */
    recordUpdaters: {},

    /**
        Property: JMAP.Connection#recordDestroyers
        Type: String[Function]

        A map of type guids to functions which will commit destroys for a
        particular record type. The function will be called with the source as
        'this' and will get the following arguments:

        storeKeys - {String[]} A list of store keys.
        ids       - {String[]} A list of the corresponding record ids.

        Once the request has been made, the following callbacks must be made to
        the <O.Store> instance as appropriate:

        * <O.Store#sourceDidCommitDestroy> if there are any commited destroys.
        * <O.Store#sourceDidNotDestroy> if there are any rejected updates.
    */
    recordDestroyers: {},

    /**
        Property: JMAP.Connection#queryFetchers
        Type: String[Function]

        A map of query type guids to functions which will fetch the requested
        contents of that query. The function will be called with the source as
        'this' and the query as the sole argument.
    */
    queryFetchers: {},

    didFetch: function ( Type, args, isAll ) {
        var store = this.get( 'store' ),
            list = args.list,
            state = args.state,
            notFound = args.notFound;
        if ( list ) {
            store.sourceDidFetchRecords( Type, list, state, isAll );
        }
        if ( notFound ) {
            store.sourceCouldNotFindRecords( Type, notFound );
        }
    },

    didFetchUpdates: function ( Type, args, reqArgs ) {
        var hasDataForChanged = reqArgs.fetchRecords;
        this.get( 'store' )
            .sourceDidFetchUpdates( Type,
                hasDataForChanged ? null : args.changed,
                args.removed,
                args.oldState,
                args.newState
            );
    },

    didCommit: function ( Type, args ) {
        var store = this.get( 'store' ),
            toStoreKey = store.getStoreKey.bind( store, Type ),
            list, object;

        if ( ( object = args.created ) && Object.keys( object ).length ) {
            store.sourceDidCommitCreate( object );
        }
        if ( ( object = args.notCreated ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotCreate( list, true, Object.values( object ) );
            }
        }
        if ( ( object = args.updated ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidCommitUpdate( list.map( toStoreKey ) )
                     .sourceDidFetchPartialRecords( Type, object );
            }

        }
        if ( ( object = args.notUpdated ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotUpdate(
                    list.map( toStoreKey ), true, Object.values( object ) );
            }
        }
        if ( ( list = args.destroyed ) && list.length ) {
            store.sourceDidCommitDestroy( list.map( toStoreKey ) );
        }
        if ( ( object = args.notDestroyed ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotDestroy(
                    list.map( toStoreKey ), true, Object.values( object ) );
            }
        }
        if ( args.newState ) {
            store.sourceCommitDidChangeState(
                Type, args.oldState, args.newState );
        }
    },

    /**
        Property: JMAP.Connection#response
        Type: String[Function]

        A map of method names to functions which the server can call in a
        response to return data to the client.
    */
    response: {
        error: function ( args, reqName, reqArgs ) {
            var type = args.type,
                method = 'error_' + reqName + '_' + type,
                response = this.response;
            if ( !response[ method ] ) {
                method = 'error_' + type;
            }
            if ( response[ method ] ) {
                response[ method ].call( this, args, reqName, reqArgs );
            }
        },
        error_unknownMethod: function ( _, requestName ) {
            // eslint-disable-next-line no-console
            console.log( 'Unknown API call made: ' + requestName );
        },
        error_invalidArguments: function ( _, requestName, requestArgs ) {
            // eslint-disable-next-line no-console
            console.log( 'API call to ' + requestName +
                'made with invalid arguments: ', requestArgs );
        },
        error_accountNotFound: function () {
            // TODO: refetch accounts list.
        },
        error_accountReadOnly: function () {
            // TODO
        },
        error_accountNoMail: function () {
            // TODO: refetch accounts list and clear out any mail data
        },
        error_accountNoContacts: function () {
            // TODO: refetch accounts list and clear out any contacts data
        },
        error_accountNoCalendars: function () {
            // TODO: refetch accounts list and clear out any calendar data
        }
    }
});

Connection.makeSetRequest = makeSetRequest;

JMAP.Connection = Connection;

}( JMAP ) );
