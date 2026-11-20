from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('matching', '0004_match_settings'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='raw',
            field=models.JSONField(default=dict),
        ),
        migrations.AddField(
            model_name='profile',
            name='settings_version',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='matchpair',
            name='settings_version',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='matchsettings',
            name='version',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.CreateModel(
            name='GoldenRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('person', models.CharField(max_length=20, unique=True)),
                ('rows', models.JSONField(default=list)),
                ('settings_version', models.PositiveIntegerField(default=0)),
                ('built_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
