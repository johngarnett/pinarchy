Pinarchy is a mobile-first responsive web app which allows players to register for event timeslots.

At the top of the page, put a heading of "Pinarchy in Parkwood"

= Timeslots and Players =

Timeslots begin at 11:30am and end at 3pm. Each slot is ten minutes in duration, so the timeslots will be:

* 11:30am
* 11:40am
* 11:50am
* ...
* 3pm

For each timeslot, two players may sign up.

Display the registered players in three columns. Columns should be as follows.

* time
* player name
* player name

= Ownership =

Tag website visitors with a cookie id so that they may be recognized each time they connect.

When someone enters a name for a timeslot, tag that name field with the player's id. Once a player field
contains data, only the player who originally added the text may edit that field. If a player deletes all data
from a text field, then clear the ownership of that field.

= Admin =

Allow the admin to edit any field. If a player visits /admin path, then prompt for the admin password.
If the correct password is provided, then put an admin cookie on the vistor. If this cookie is present
on an app user, then allow any name field to be edited.

The admin password should be configurable via an environment variable.

= Print =

Add a print button that displays the registered players in a format that will look good when printed.

= Implementation =

Use NodeJS and Express to implement the web server and app logic.

Use SQLite to implement persistence of the registered players and associated timeslots.

Choose a lightweight CSS framework to provide mobile first design, responsiveness, and a clean look.

= env =

Generate COOKIE_SECRET

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
