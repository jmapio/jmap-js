// -------------------------------------------------------------------------- \\
// File: calendarEventUploads.js                                              \\
// Module: CalendarModel                                                      \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const clone = O.clone;
const Class = O.Class;

const store = JMAP.store;
const calendar = JMAP.calendar;
const LocalFile = JMAP.LocalFile;

// ---

const eventUploads = {

    inProgress: {},
    awaitingSave: {},

    get: function ( event ) {
        var id = event.get( 'storeKey' ),
            isEdit = event.get( 'store' ).isNested,
            files = this.inProgress[ id ];

        return files ? files.filter( function ( file ) {
            return isEdit ? file.inEdit : file.inServer;
        }) : [];
    },

    add: function ( event, file ) {
        var id = event.get( 'storeKey' ),
            files = this.inProgress[ id ] || ( this.inProgress[ id ] = [] );
        files.push( file );
        event.computedPropertyDidChange( 'files' );
    },

    remove: function ( event, file ) {
        var id = event.get( 'storeKey' ),
            isEdit = event.get( 'store' ).isNested,
            files = this.inProgress[ id ];

        if ( isEdit && file.inServer ) {
            file.inEdit = false;
        } else {
            files.erase( file );
            if ( !files.length ) {
                delete this.inProgress[ id ];
            }
            file.destroy();
        }
        event.computedPropertyDidChange( 'files' );
    },

    finishEdit: function ( event, source, destination ) {
        var id = event.get( 'storeKey' ),
            files = this.inProgress[ id ],
            l, file;
        if ( files ) {
            l = files.length;
            while ( l-- ) {
                file = files[l];
                if ( !file[ source ] ) {
                    files.splice( l, 1 );
                    file.destroy();
                } else {
                    file[ destination ] = true;
                }
            }
            if ( !files.length ) {
                delete this.inProgress[ id ];
            }
        }
        delete this.awaitingSave[ id ];
    },

    save: function ( event ) {
        var awaitingSave = this.awaitingSave[ event.get( 'storeKey' ) ],
            i, l;
        if ( awaitingSave ) {
            for ( i = 0, l = awaitingSave.length; i < l; i += 1 ) {
                this.keepFile( awaitingSave[i][0], awaitingSave[i][1] );
            }
        }
        this.finishEdit( event, 'inEdit', 'inServer' );
        event.getDoppelganger( store )
                 .computedPropertyDidChange( 'files' );
    },

    discard: function ( event ) {
        this.finishEdit( event, 'inServer', 'inEdit' );
        event.getDoppelganger( calendar.editStore )
                .computedPropertyDidChange( 'files' );
    },

    didUpload: function ( file ) {
        var inEdit = file.inEdit,
            inServer = file.inServer,
            link = {
                href: file.get( 'url' ),
                rel: 'enclosure',
                title: file.get( 'name' ),
                type: file.get( 'type' ),
                size: file.get( 'size' )
            },
            editEvent = file.editEvent,
            editLinks = clone( editEvent.get( 'links' ) ) || {},
            id, awaitingSave,
            serverEvent, serverLinks;

        if ( !inServer ) {
            id = editEvent.get( 'storeKey' );
            awaitingSave = this.awaitingSave;
            ( awaitingSave[ id ] ||
                ( awaitingSave[ id ] = [] ) ).push([
                    file.get( 'path' ), file.get( 'name' ) ]);
            editLinks[ link.href ] = link;
            editEvent.set( 'links', editLinks );
            this.remove( editEvent, file );
        } else {
            this.keepFile( file.get( 'path' ), file.get( 'name' ) );
            // Save new attachment to server
            serverEvent = editEvent.getDoppelganger( store );
            serverLinks = clone( serverEvent.get( 'links' ) ) || {};
            serverLinks[ link.href ] = link;
            serverEvent.set( 'links', serverLinks );
            // If in edit, push to edit record as well.
            if ( inEdit ) {
                editLinks[ link.href ] = link;
            }
            editEvent.set( 'links', editLinks );
            this.remove( serverEvent, file );
        }
    },

    didFail: function ( file ) {
        var event = file.editEvent;
        file.inServer = false;
        this.remove( event, file );
        event.getDoppelganger( store )
             .computedPropertyDidChange( 'files' );
    },

    keepFile: function ( path, name ) {
        // TODO: Create Storage Node in Calendar Event Attachments folder.
    },
};

const CalendarAttachment = Class({

    Extends: LocalFile,

    init: function ( file, event ) {
        this.editEvent = event;
        this.inServer = false;
        this.inEdit = true;
        CalendarAttachment.parent.constructor.call( this, file );
    },

    uploadDidSucceed: function () {
        eventUploads.didUpload( this );
    },
    uploadDidFail: function () {
        eventUploads.didFail( this );
    }
});

// --- Export

JMAP.CalendarAttachment = CalendarAttachment;
JMAP.calendar.eventUploads = eventUploads;

}( JMAP ) );
