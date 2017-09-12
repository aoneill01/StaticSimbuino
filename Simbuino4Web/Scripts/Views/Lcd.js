﻿$(function () {

	Lcd =
	{
		Init: function (context)
		{
			var self = this;
			this.Width = 84;
			this.Height = 48;
			this.Pixels = [];
			this.PrevPixels = [];
			this.ImageChanged = [];
			this.PropertyChanged = [];
			this.LastRefresh = 0;

			this.Context = context;
			this.Image = this.Context.getImageData(0, 0, 84 * 8, 48 * 8);

			this.SCE_PORT = AtmelContext.C; // A1
			this.SCE_BIT = 1;
			this.RESET_PORT = AtmelContext.C; // A0
			this.RESET_BIT = 0;
			this.DC_PORT = AtmelContext.C; // A2
			this.DC_BIT = 2;		

			this.CurrentX = 0;
			this.CurrentY = 0;
			this.ExtendedMode = false;

			this.Reset();
			this.RESET_PORT.WriteRegister.get().OnRegisterChanged.push(function (oldVal, newVal) { self.Lcd_OnResetChanged(oldVal, newVal); });
			SPI.OnReceivedByte.push(function (val) { self.spi_OnReceivedByte(val); });

			this.Reset();
			this.CreateImage();
		},

		Reset: function()
		{
			this.Pixels = [];
			this.PrevPixels = [];
			var num_pixels = this.Width * this.Height;
			for (var i=0; i<num_pixels; i++) {
				this.Pixels[i] = 0;
				this.PrevPixels[i] = 0;
			}
			this.LastRefresh = 0;
			this.LcdBackground = { R: 0x8f, G: 0xa7, B: 0x9a };
			this.LcdForeground = { R: 0x40, G: 0x40, B: 0x40 };
			this.LcdIntermediate = { R: 0x70, G: 0x80, B: 0x71 };
			this.LcdBacklight = { R: 0xce, G: 0xdd, B: 0xe7 };
			this.LcdCurrentBacklight = { R: 0, G: 0, B: 0 };
			this.Refresh(true);
		},

		Lcd_OnResetChanged: function(oldVal, newVal)
		{
			var changed = oldVal ^ newVal;
			if ((changed & (1 << this.RESET_BIT)) == 0)
				return;
			if ((newVal & (1 << this.RESET_BIT)) == 0)
				return;
			this.CurrentX = 0;
			this.CurrentY = 0;
			this.ExtendedMode = false;
			for (var i = 0; i < this.Pixels.length; i++) {
				this.Pixels[i] = 0;
				this.PrevPixels[i] = 0;
			}
		},

		SetPixel: function(x, y, color)
		{
			if (x == 0 && y == 0) {
				var num_pixels = this.Width * this.Height;
				for (var i=0; i<num_pixels; i++) {
					this.PrevPixels[i] = this.Pixels[i];
				}
			}
			var ofs = y * this.Width + x;
			if (color == 0)
				this.Pixels[y * this.Width + x] = 0;
			else
				this.Pixels[y * this.Width + x] = 255;
		},

		Refresh: function(force)
		{
			var elapsed = AtmelContext.Clock - this.LastRefresh;
			if (!force) {
				if (elapsed < AtmelProcessor.ClockSpeed / 30)
					return;
				if (elapsed == 0)
					return;
			}
			this.CalculateBacklight();
			this.LastRefresh = AtmelContext.Clock;
			this.CreateImage();
		},

		CalculateBacklight: function()
		{
			var level = 0;
			var TCCR0A = AtmelContext.RAM[AtmelIO.TCCR0A].get();
			if ((TCCR0A & (1 << AtmelIO.COM0B1)) != 0)
			{
				// pwm
				level = AtmelContext.RAM[AtmelIO.OCR0B].get();
			}
			else
			{
				// digital
				if ((AtmelContext.D.WriteRegister.get().get() & 0x20) != 0)
					level = 255;
				else
				level = 0;
			}

			this.LcdCurrentBacklight.R = Math.floor(this.LcdBackground.R + level * (this.LcdBacklight.R - this.LcdBackground.R) / 255);
			this.LcdCurrentBacklight.G = Math.floor(this.LcdBackground.G + level * (this.LcdBacklight.G - this.LcdBackground.G) / 255);
			this.LcdCurrentBacklight.B = Math.floor(this.LcdBackground.B + level * (this.LcdBacklight.B - this.LcdBackground.B) / 255);
		},

		spi_OnReceivedByte: function(data)
		{
			// make sure the Lcd is currently enabled
			if ((this.SCE_PORT.WriteRegister.get().get() & (1 << this.SCE_BIT)) != 0)
				return;

			// what did we just receive?
			if ((this.DC_PORT.WriteRegister.get().get() & (1 << this.DC_BIT)) != 0)
			{
				// D/C is set to data, store this byte in display memory and advance the ptr
				for (var i = 0; i < 8; i++)
					this.SetPixel(this.CurrentX, this.CurrentY * 8 + i, (data >> i) & 1);
				this.CurrentX++;
				if (this.CurrentX >= this.Width)
				{
					this.CurrentX = 0;
					this.CurrentY++;
					if (this.CurrentY >= this.Height / 8)
					{
						// sent the last byte to the screen, force an update
						this.CurrentY = 0;
						this.Refresh(true);
					}
				}
			}
			else if (data == 0x00)
			{
				// nop
			}
			else if ((data & 0xf8) == 0x20)
			{
				// function set
				this.ExtendedMode = (data & 1) != 0;
			}
			else if (!this.ExtendedMode)
			{
				// H == 0
				if ((data & 0xf8) == 0x40)
					this.CurrentY = Math.min(data & 7, this.Height - 1);
				else if ((data & 0x80) == 0x80)
					this.CurrentX = Math.min(data & 0x7f, this.Width - 1);
			}
			else
			{
				// H == 1
			}
		},

		CreateImage : function()
		{						
			var backR = this.LcdCurrentBacklight.R;
			var backG = this.LcdCurrentBacklight.G;
			var backB = this.LcdCurrentBacklight.B;
			var foreR = this.LcdForeground.R;
			var foreG = this.LcdForeground.G;
			var foreB = this.LcdForeground.B;
			var interR = this.LcdIntermediate.R;
			var interG = this.LcdIntermediate.G;
			var interB = this.LcdIntermediate.B;
			var pixels = this.Pixels;
			var prevPixels = this.PrevPixels;

			var data = this.Image.data;
			for (var row = 0; row < this.Height; row++) {
				for (var col = 0; col < this.Width; col++) {
					if (pixels [row * this.Width + col]) {
						for (var j = 0; j < 8; j++) {
							for (var k = 0; k < 8; k++) {
								var addr = 4 * (8 * 8 * row * this.Width + 8 * col + j + 8 * k * this.Width);
								data[addr] = foreR;
								data[addr + 1] = foreG;
								data[addr + 2] = foreB;
								data[addr + 3] = 255;
							}
						}
					}
					else if (prevPixels [row * this.Width + col]) {
						for (var j = 0; j < 8; j++) {
							for (var k = 0; k < 8; k++) {
								var addr = 4 * (8 * 8 * row * this.Width + 8 * col + j + 8 * k * this.Width);
								data[addr] = interR;
								data[addr + 1] = interG;
								data[addr + 2] = interB;
								data[addr + 3] = 255;
							}
						}
					}
					else {
						for (var j = 0; j < 8; j++) {
							for (var k = 0; k < 8; k++) {
								var addr = 4 * (8 * 8 * row * this.Width + 8 * col + j + 8 * k * this.Width);
								data[addr] = backR;
								data[addr + 1] = backG;
								data[addr + 2] = backB;
								data[addr + 3] = 255;
							}
						}
					}
				}
			}
			
			this.Context.putImageData(this.Image, 0, 0);
		}


	}
});
