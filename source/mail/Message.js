// -------------------------------------------------------------------------- \\
// File: Message.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const isEqual = O.isEqual;
const clone = O.clone;
const guid = O.guid;
const i18n = O.i18n;
const Class = O.Class;
const Status = O.Status;
const EMPTY = Status.EMPTY;
const READY = Status.READY;
const LOADING = Status.LOADING;
const NEW = Status.NEW;
const Record = O.Record;
const attr = Record.attr;

const applyPatch = JMAP.Connection.applyPatch;
const Mailbox = JMAP.Mailbox;
const mail = JMAP.mail;

// ---

const parseStructure = function  ( parts, multipartType, inAlternative,
        htmlParts, textParts, fileParts ) {

    // For multipartType == alternative
    var textLength = textParts ? textParts.length : -1;
    var htmlLength = htmlParts ? htmlParts.length : -1;
    var i;

    for ( i = 0; i < parts.length; i += 1 ) {
        var part = parts[i];
        var type = part.type;
        var isTextOrHTML = false;
        var isMultipart = false;
        var isImage = false;
        var isInline, subMultiType;

        if ( type === 'text/plain' || type === 'text/html' ) {
            isTextOrHTML = true;
        } else if ( type.startsWith( 'multipart/' ) ) {
            isMultipart = true;
        } else if ( type.startsWith( 'image/' ) ) {
            isImage = true;
        }

        // Is this a body part rather than an attachment
        isInline =
            // Must be one of the allowed body types
            ( isTextOrHTML || isImage ) &&
            // Must not be explicitly marked as an attachment
            part.disposition !== 'attachment' &&
            // If multipart/related, only the first part can be inline
            // If a text part with a filename, and not the first item in the
            // multipart, assume it is an attachment
            ( i === 0 ||
                ( multipartType !== 'related' && ( isImage || !part.name ) ) );

        if ( isMultipart ) {
            subMultiType = type.split( '/' )[1];
            parseStructure( part.subParts, subMultiType,
                inAlternative || ( subMultiType === 'alternative' ),
                htmlParts, textParts, fileParts );
        } else if ( isInline ) {
            if ( multipartType === 'alternative' ) {
                switch ( type ) {
                case 'text/plain':
                    textParts.push( part );
                    break;
                case 'text/html':
                    htmlParts.push( part );
                    break;
                default:
                    fileParts.push( part );
                    break;
                }
                continue;
            } else if ( inAlternative ) {
                if ( type === 'text/plain' ) {
                    htmlParts = null;
                }
                if ( type === 'text/html' ) {
                    textParts = null;
                }
            }
            if ( textParts ) {
                textParts.push( part );
            }
            if ( htmlParts ) {
                htmlParts.push( part );
            }
            if ( isImage ) {
                part.isInline = true;
                fileParts.push( part );
            }
        } else {
            fileParts.push( part );
        }
    }

    if ( multipartType === 'alternative' && textParts && htmlParts ) {
        // Found HTML part only
        if ( textLength === textParts.length &&
                htmlLength !== htmlParts.length ) {
            for ( i = htmlLength; i < htmlParts.length; i += 1 ) {
                textParts.push( htmlParts[i] );
            }
        }
        // Found plain text part only
        if ( htmlLength === htmlParts.length &&
                textLength !== textParts.length ) {
            for ( i = textLength; i < textParts.length; i += 1 ) {
                htmlParts.push( textParts[i] );
            }
        }
    }
};

const keywordProperty = function ( keyword ) {
    return function ( value ) {
        if ( value !== undefined ) {
            this.setKeyword( keyword, value );
        } else {
            value = this.get( 'keywords' )[ keyword ];
        }
        return !!value;
    // doNotNotify because observers will be notified already due to the
    // keywords dependency.
    }.property( 'keywords' ).doNotNotify();
};

const MessageDetails = Class({ Extends: Record });
const MessageThread = Class({ Extends: Record });
const MessageBodyValues = Class({ Extends: Record });

const Message = Class({

    Extends: Record,

    thread: Record.toOne({
        // Type: JMAP.Thread,
        key: 'threadId',
        noSync: true,
    }),

    mailboxes: Record.toMany({
        recordType: Mailbox,
        key: 'mailboxIds',
        Type: Object,
    }),

    keywords: attr( Object, {
        defaultValue: {}
    }),

    hasAttachment: attr( Boolean, {
        noSync: true,
    }),

    from: attr( Array ),
    to: attr( Array ),
    subject: attr( String ),

    receivedAt: attr( Date, {
        toJSON: Date.toUTCJSON,
    }),

    size: attr( Number, {
        noSync: true,
    }),

    preview: attr( String, {
        noSync: true,
    }),

    // ---

    getThreadIfReady: function () {
        var store = this.get( 'store' );
        var threadSK = this.getData().threadId;
        if ( store.getStatus( threadSK ) & READY ) {
            return this.get( 'thread' );
        }
        return null;
    },

    hasPermission: function ( permission ) {
        return this.get( 'mailboxes' ).every( function ( mailbox ) {
            return mailbox.get( 'myRights' )[ permission ];
        });
    },

    isIn: function ( role ) {
        return this.get( 'mailboxes' ).some( function ( mailbox ) {
            return mailbox.get( 'role' ) === role;
        });
    },

    isInTrash: function () {
        return this.isIn( 'trash' );
    }.property( 'mailboxes' ),

    isInNotTrash: function () {
        return !this.get( 'isInTrash' ) ||
            ( this.get( 'mailboxes' ).get( 'length' ) > 1 );
    }.property( 'mailboxes' ),

    notifyThread: function () {
        var thread = this.getThreadIfReady();
        if ( thread ) {
            thread.propertyDidChange( 'messages' );
        }
    }.queue( 'before' ).observes( 'mailboxes', 'keywords', 'hasAttachment' ),

    // ---

    isUnread: function ( value ) {
        if ( value !== undefined ) {
            this.setKeyword( '$seen', !value );
        } else {
            var keywords = this.get( 'keywords' );
            value = !keywords.$seen && !keywords.$draft;
        }
        return value;
    }.property( 'keywords' ),

    isDraft: keywordProperty( '$draft' ),
    isFlagged: keywordProperty( '$flagged' ),
    isAnswered: keywordProperty( '$answered' ),
    isForwarded: keywordProperty( '$forwarded' ),
    isPhishing: keywordProperty( '$phishing' ),

    setKeyword: function ( keyword, value ) {
        var keywords = clone( this.get( 'keywords' ) );
        if ( value ) {
            keywords[ keyword ] = true;
        } else {
            delete keywords[ keyword ];
        }
        return this.set( 'keywords', keywords );
    },

    // ---

    fromName: function () {
        var from = this.get( 'from' );
        var emailer = from && from[0] || null;
        return emailer &&
            ( emailer.name ||
            ( emailer.email && emailer.email.split( '@' )[0] ) ) ||
            '';
    }.property( 'from' ),

    fromEmail: function () {
        var from = this.get( 'from' );
        var emailer = from && from[0] || null;
        return emailer && emailer.email || '';
    }.property( 'from' ),

    // ---

    fullDate: function () {
        var date = this.get( 'receivedAt' );
        return i18n.date( date, 'fullDateAndTime' );
    }.property( 'receivedAt' ),

    relativeDate: function () {
        var date = this.get( 'receivedAt' );
        return date.relativeTo( null, true, true );
    }.property().nocache(),

    formattedSize: function () {
        return i18n.fileSize( this.get( 'size' ), 1 );
    }.property( 'size' ),

    // ---

    detailsStatus: function ( status ) {
        if ( status !== undefined ) {
            return status;
        }
        if ( this.get( 'blobId' ) || this.is( NEW ) ) {
            return READY;
        }
        return EMPTY;
    }.property( 'blobId' ),

    fetchDetails: function () {
        if ( this.get( 'detailsStatus' ) === EMPTY ) {
            mail.fetchRecord(
                this.get( 'accountId' ), MessageDetails, this.get( 'id' ) );
            this.set( 'detailsStatus', EMPTY|LOADING );
        }
    },

    blobId: attr( String, {
        noSync: true,
    }),

    messageId: attr( Array ),
    inReplyTo: attr( Array ),
    references: attr( Array ),

    listId: attr( String, {
        key: 'header:list-id:asText',
    }),
    _listPost: attr( Array, {
        key: 'header:list-post:asURLs',
    }),
    listPost: function () {
        var urls = this.get( '_listPost' );
        return urls && urls[0] || '';
    }.property( '_listPost' ),

    sender: attr( Array ),
    replyTo: attr( Array ),
    cc: attr( Array ),
    bcc: attr( Array ),
    sentAt: attr( Date, {
        toJSON: Date.toTimezoneOffsetJSON,
    }),

    bodyStructure: attr( Object ),
    bodyValues: attr( Object ),

    bodyParts: function () {
        var bodyStructure = this.get( 'bodyStructure' );
        var htmlParts = [];
        var textParts = [];
        var fileParts = [];

        if ( bodyStructure ) {
            parseStructure( [ bodyStructure ], 'mixed', false,
                htmlParts, textParts, fileParts );
        }

        return {
            html: htmlParts,
            text: textParts,
            files: fileParts,
        };
    }.property( 'bodyStructure' ),

    hasHTMLBody: function () {
        return this.get( 'bodyParts' ).html.some( function ( part ) {
            return part.type === 'text/html';
        });
    }.property( 'bodyParts' ),

    hasTextBody: function () {
        return this.get( 'bodyParts' ).text.some( function ( part ) {
            return part.type === 'text/plain';
        });
    }.property( 'bodyParts' ),

    areBodyValuesFetched: function ( type ) {
        var bodyParts = this.get( 'bodyParts' );
        var bodyValues = this.get( 'bodyValues' );
        var partIsFetched = function ( part ) {
            var value = bodyValues[ part.partId ];
            return !part.type.startsWith( 'text' ) ||
                ( !!value && !value.isTruncated );

        };
        var isFetched = true;
        if ( isFetched && type !== 'text' ) {
            isFetched = bodyParts.html.every( partIsFetched );
        }
        if ( isFetched && type !== 'html' ) {
            isFetched = bodyParts.text.every( partIsFetched );
        }
        return isFetched;
    },

    fetchBodyValues: function () {
        mail.fetchRecord(
            this.get( 'accountId' ), MessageBodyValues, this.get( 'id' ) );
    },

    // ---

    hasObservers: function () {
        if ( Message.parent.hasObservers.call( this ) ) {
            return true;
        }
        var data = this.getData();
        var threadSK = data && data.threadId;
        if ( threadSK ) {
            return this.get( 'store' )
                .materialiseRecord( threadSK )
                .hasObservers();
        }
        return false;
    },
});
Message.__guid__ = 'Email';
Message.dataGroup = 'urn:ietf:params:jmap:mail';

Message.headerProperties = [
    'threadId',
    'mailboxIds',
    'keywords',
    'hasAttachment',
    'from',
    'to',
    'subject',
    'receivedAt',
    'size',
    'preview',
];
Message.detailsProperties = [
    'blobId',
    'messageId',
    'inReplyTo',
    'references',
    'header:list-id:asText',
    'header:list-post:asURLs',
    'sender',
    'cc',
    'bcc',
    'replyTo',
    'sentAt',
    'bodyStructure',
    'bodyValues',
];
Message.bodyProperties = [
    'partId',
    'blobId',
    'size',
    'name',
    'type',
    'charset',
    'disposition',
    'cid',
    'location',
];
Message.Details = MessageDetails;
Message.Thread = MessageThread;
Message.BodyValues = MessageBodyValues;

// ---

mail.handle( MessageDetails, {
    fetch: function ( accountId, ids ) {
        this.callMethod( 'Email/get', {
            accountId: accountId,
            ids: ids,
            properties: Message.detailsProperties,
            fetchHTMLBodyValues: true,
            bodyProperties: Message.bodyProperties,
        });
    },
});

mail.handle( MessageBodyValues, {
    fetch: function ( accountId, ids ) {
        this.callMethod( 'Email/get', {
            accountId: accountId,
            ids: ids,
            properties: [ 'bodyValues' ],
            fetchAllBodyValues: true,
            bodyProperties: Message.bodyProperties,
        });
    },
});

// ---

mail.handle( MessageThread, {
    fetch: function ( accountId, ids ) {
        this.callMethod( 'Email/get', {
            accountId: accountId,
            ids: ids,
            properties: [ 'threadId' ],
        });
        this.callMethod( 'Thread/get', {
            accountId: accountId,
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                name: 'Email/get',
                path: '/list/*/threadId',
            },
        });
        this.callMethod( 'Email/get', {
            accountId: accountId,
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                name: 'Thread/get',
                path: '/list/*/emailIds',
            },
            properties: Message.headerProperties
        });
    },
});

// ---

mail.messageChangesMaxChanges = 50;
mail.handle( Message, {

    precedence: 1,

    fetch: function ( accountId, ids ) {
        // Called with ids == null if you try to refresh before we have any
        // data loaded. Just ignore.
        if ( ids ) {
            this.callMethod( 'Email/get', {
                accountId: accountId,
                ids: ids,
                properties: Message.headerProperties
            });
        }
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Email/get', {
                accountId: accountId,
                ids: ids,
                properties: [
                    'mailboxIds',
                    'keywords',
                ]
            });
        } else {
            this.callMethod( 'Email/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: this.messageChangesMaxChanges,
            });
        }
    },

    commit: 'Email',

    // ---

    'Email/get': function ( args, _, reqArgs ) {
        var store = this.get( 'store' );
        var list = args.list;
        var accountId = args.accountId;
        var l = list ? list.length : 0;
        var message, updates, storeKey;

        // Ensure no null subject, leave message var inited for below
        while ( l-- ) {
            message = list[l];
            if ( message.subject === null ) {
                message.subject = '';
            }
        }

        if ( !message || message.receivedAt ) {
            this.didFetch( Message, args, false );
        } else if ( message.mailboxIds ) {
            // keywords/mailboxIds (OBSOLETE message refreshed)
            updates = list.reduce( function ( updates, message ) {
                updates[ message.id ] = message;
                return updates;
            }, {} );
            store.sourceDidFetchPartialRecords( accountId, Message, updates );
        } else if ( !isEqual( reqArgs.properties, [ 'threadId' ] ) ) {
            // This is all immutable data with no foreign key refs, so we don't
            // need to use sourceDidFetchPartialRecords, and this let's us
            // work around a bug where the data is discarded if the message
            // is currently COMMITTING (e.g. moved or keywords changed).
            l = list.length;
            while ( l-- ) {
                message = list[l];
                storeKey = store.getStoreKey( accountId, Message, message.id );
                if ( store.getStatus( storeKey ) & READY ) {
                    store.updateData( storeKey, message, false );
                }
            }
        }
    },

    'Email/changes': function ( args ) {
        this.didFetchUpdates( Message, args, false );
        if ( args.updated && args.updated.length ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreChanges ) {
            var messageChangesMaxChanges = this.messageChangesMaxChanges;
            if ( messageChangesMaxChanges < 150 ) {
                if ( messageChangesMaxChanges === 50 ) {
                    this.messageChangesMaxChanges = 100;
                } else {
                    this.messageChangesMaxChanges = 150;
                }
                this.fetchMoreChanges( args.accountId, Message );
                return;
            } else {
                // We've fetched 300 updates and there's still more. Let's give
                // up and reset.
                this.response[ 'error_Email/changes_cannotCalculateChanges' ]
                    .apply( this, arguments );
            }
        }
        this.messageChangesMaxChanges = 50;
    },

    'Email/copy': function ( args, _, reqArgs ) {
        this.didCopy( Message, args, reqArgs );
    },

    'error_Email/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Mark all messages as obsolete.
        // The garbage collector will eventually clean up any messages that
        // no longer exist
        store.getAll( Message ).forEach( function ( message ) {
            if ( message.get( 'accountId' ) === accountId ) {
                message.setObsolete();
            }
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates( accountId,
            Message, null, null, store.getTypeState( accountId, Message ), '' );
    },

    'Email/set': function ( args, reqName, reqArgs ) {
        // If we did a set implicitly on successful send, the change is not in
        // the store, so don't call didCommit. Instead we tell the store the
        // updates the server has made.
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        if ( reqName === 'EmailSubmission/set' ) {
            var create = reqArgs.create;
            var onSuccessUpdateEmail = reqArgs.onSuccessUpdateEmail;
            var onSuccessDestroyEmail = reqArgs.onSuccessDestroyEmail;
            var updates = {};
            var destroyed = [];
            var emailId, storeKey, path, id, update, data;
            for ( id in create ) {
                emailId = create[ id ].emailId;
                if ( emailId.charAt( 0 ) === '#' ) {
                    storeKey = emailId.slice( 1 );
                    emailId = store.getIdFromStoreKey( storeKey );
                } else {
                    storeKey = store.getStoreKey( accountId, Message, emailId );
                }
                id = '#' + id;
                if ( onSuccessUpdateEmail &&
                        ( update = onSuccessUpdateEmail[ id ] )) {
                    // If we've made further changes since this commit, bail
                    // out. This is just an optimisation, and we'll fetch the
                    // real changes from the source instead automatically if
                    // we don't do it.
                    if ( store.getStatus( storeKey ) !== READY ) {
                        updates = null;
                        break;
                    }
                    data = store.getData( storeKey );
                    data = {
                        keywords: clone( data.keywords ),
                        mailboxIds: Object.keys( data.mailboxIds ).reduce(
                            function ( mailboxIds, storeKey ) {
                                mailboxIds[
                                    store.getIdFromStoreKey( storeKey )
                                ] = true;
                                return mailboxIds;
                            },
                            {}
                        ),
                    };
                    for ( path in update ) {
                        applyPatch( data, path, update[ path ] );
                    }
                    updates[ emailId ] = data;
                } else if ( onSuccessDestroyEmail &&
                        onSuccessDestroyEmail.contains( id ) ) {
                    destroyed.push( emailId );
                }
            }
            if ( updates ) {
                store.sourceDidFetchUpdates( accountId,
                    Message, [], destroyed, args.oldState, args.newState );
                store.sourceDidFetchPartialRecords( accountId,
                    Message, updates );
            }
            // And we invalidate all MessageList queries, as some may be
            // invalid and we don't know which ones.
            this.get( 'store' )
                .fire( guid( Message ) + ':server:' + accountId );
            return;
        }
        this.didCommit( Message, args );
    },
});

// --- Export

JMAP.Message = Message;

}( JMAP ) );
