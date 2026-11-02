"""Gunicorn settings, read automatically when the hosted server starts (render.yaml runs gunicorn from here).

Reading a big table on Data profiling (fetch, profile, silver summary, save) can take longer than gunicorn's
default 30 seconds on the free plan's small CPU; a worker stopped halfway restarts the whole server.
"""

timeout = 120
